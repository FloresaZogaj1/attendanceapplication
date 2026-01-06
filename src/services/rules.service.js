import { pool } from "../config/db.js";
import { setTimeOnDate, minutesDiff, clampMin } from "../utils/time.js";
import { addEvent, upsertIncident, computeNotifyAfter20, calcLateMinutes } from "./attendance.service.js";

const RULES = {
  CHECKIN_LATE_AFTER: "09:05:00",
  CHECKOUT_AUTO_AT: "17:00:00",

  LUNCH_WINDOW_START: "12:00:00",
  LUNCH_WINDOW_END: "13:00:00",
  LUNCH_MAX_MIN: 60,

  MINI_BREAK_MAX_MIN: 7,
  MINI_BREAK_MAX_PER_DAY: 3,
  MINI_BREAK_BEFORE_LIMIT: 2,
  MINI_BREAK_AFTER_DEFAULT: 1,

  TOTAL_BREAK_MAX_MIN: 60,

  COMP_RATIO: 3
};

async function getRuleProfile(userId) {
  const [[row]] = await pool.query("SELECT flex_mode FROM users WHERE id=?", [userId]);
  return { isFlex: Boolean(row?.flex_mode) };
}

async function recalcWorkdayTotals(workdayId) {
  const [[wd]] = await pool.query(
    "SELECT w.*, COALESCE(u.flex_mode,0) AS flex_mode FROM workday w JOIN users u ON u.id=w.user_id WHERE w.id=?",
    [workdayId]
  );

  let lunchMin = 0;
  if (wd.lunch_start && wd.lunch_end) {
    lunchMin = clampMin(minutesDiff(new Date(wd.lunch_start), new Date(wd.lunch_end)));
  }

  const [[mbAgg]] = await pool.query(
    "SELECT COALESCE(SUM(duration_minutes),0) AS mbMin, COALESCE(SUM(exceeded_minutes),0) AS mbExceeded FROM mini_break WHERE workday_id=?",
    [workdayId]
  );

  const isFlex = Boolean(wd.flex_mode);
  const breakTotal = lunchMin + Number(mbAgg.mbMin);
  const exceededTotal = isFlex ? 0 : clampMin(breakTotal - RULES.TOTAL_BREAK_MAX_MIN);

  const baseLate = isFlex ? 0 : Number(wd.late_minutes);
  const exceededMini = isFlex ? 0 : Number(mbAgg.mbExceeded);
  const comp = baseLate + exceededMini + exceededTotal;
  const compWork = isFlex ? 0 : comp * RULES.COMP_RATIO;

  await pool.query(
    "UPDATE workday SET break_total_minutes=?, compensation_minutes=?, compensation_work_minutes=? WHERE id=?",
    [breakTotal, comp, compWork, workdayId]
  );

  return { breakTotal, exceededTotal, comp, compWork };
}

export async function employeeCheckin({ userId, at = new Date(), status = "normal" }) {
  const dayDate = new Date(at);
  const day = `${dayDate.getFullYear()}-${String(dayDate.getMonth() + 1).padStart(2, "0")}-${String(dayDate.getDate()).padStart(2, "0")}`;

  const [[wd]] = await pool.query("SELECT * FROM workday WHERE user_id=? AND day_date=?", [userId, day]);
  const { isFlex } = await getRuleProfile(userId);

  if (wd?.checkin_at && !isFlex) {
    return { ok: false, error: "Already checked in today" };
  }

  let workdayId;
  if (!wd) {
    const [ins] = await pool.query("INSERT INTO workday(user_id, day_date) VALUES(?,?)", [userId, day]);
    workdayId = ins.insertId;
  } else {
    workdayId = wd.id;
  }

  const lateMin = isFlex ? 0 : calcLateMinutes(new Date(at), RULES.CHECKIN_LATE_AFTER);
  await pool.query(
    "UPDATE workday SET checkin_at=?, checkin_status=?, late_minutes=? WHERE id=?",
    [at, status, lateMin, workdayId]
  );

  const meta = isFlex ? { flex: true } : { lateMin };
  await addEvent({ userId, workdayId, type: "checkin", at, status, meta });

  let notice = null;

  if (!isFlex && lateMin > 0) {
    const notifyAfter = at;
    await upsertIncident({
      userId,
      workdayId,
      code: "LATE_CHECKIN",
      message: `Late check-in: ${lateMin} min. Compensation: ${lateMin * RULES.COMP_RATIO} min.`,
      severity: "warn",
      occurredAt: at,
      notifyAfter
    });

    notice = `Jeni vonuar ${lateMin} minuta dhe duhet të qëndroni ${lateMin * RULES.COMP_RATIO} minuta shtesë pas orarit.`;
  }

  await recalcWorkdayTotals(workdayId);

  return { ok: true, lateMin, workdayId, notice, flex: isFlex };
}

export async function employeeCheckout({ userId, at = new Date(), status = "normal", manualCheckinTime = null }) {
  const dayDate = new Date(at);
  const day = `${dayDate.getFullYear()}-${String(dayDate.getMonth() + 1).padStart(2, "0")}-${String(dayDate.getDate()).padStart(2, "0")}`;

  const [[wdRow]] = await pool.query("SELECT * FROM workday WHERE user_id=? AND day_date=?", [userId, day]);
  let wd = wdRow;
  const { isFlex } = await getRuleProfile(userId);

  if (!wd) {
    if (!manualCheckinTime && !isFlex) return { ok: false, error: "Missing check-in. Provide manual check-in time." };

    const manualAt = manualCheckinTime ? new Date(`${day}T${manualCheckinTime}`) : at;
    const lateMin = isFlex ? 0 : calcLateMinutes(new Date(manualAt), RULES.CHECKIN_LATE_AFTER);

    const [ins] = await pool.query(
      "INSERT INTO workday(user_id, day_date, checkin_at, checkin_status, late_minutes) VALUES(?,?,?,?,?)",
      [userId, day, manualAt, manualCheckinTime ? "manual" : status, lateMin]
    );

    wd = { id: ins.insertId, checkin_at: manualAt, day_date: day, late_minutes: lateMin };

    await addEvent({
      userId,
      workdayId: wd.id,
      type: "checkin",
      at: manualAt,
      status: manualCheckinTime ? "manual" : status,
      meta: isFlex ? { flex: true, reason: "auto_created_for_checkout" } : { reason: "checkout_without_checkin" }
    });

    if (!isFlex) {
      const notifyAfter = computeNotifyAfter20(new Date(at));
      await upsertIncident({
        userId,
        workdayId: wd.id,
        code: "NO_CHECKIN_MANUAL_CHECKOUT",
        message: "Checkout without check-in. Manual check-in was added.",
        severity: "warn",
        occurredAt: at,
        notifyAfter
      });
    }
  } else {
    if (wd.checkout_at && !isFlex) return { ok: false, error: "Already checked out" };

    if (!wd.checkin_at) {
      if (!manualCheckinTime && !isFlex) return { ok: false, error: "Missing check-in. Provide manual check-in time." };

      const manualAt = manualCheckinTime ? new Date(`${day}T${manualCheckinTime}`) : at;
      const lateMin = isFlex ? 0 : calcLateMinutes(new Date(manualAt), RULES.CHECKIN_LATE_AFTER);

      await pool.query(
        "UPDATE workday SET checkin_at=?, checkin_status=?, late_minutes=? WHERE id=?",
        [manualAt, manualCheckinTime ? "manual" : status, lateMin, wd.id]
      );
      wd.checkin_at = manualAt;
      wd.late_minutes = lateMin;

      await addEvent({
        userId,
        workdayId: wd.id,
        type: "checkin",
        at: manualAt,
        status: manualCheckinTime ? "manual" : status,
        meta: isFlex ? { flex: true, reason: "auto_created_for_checkout" } : { reason: "checkout_without_checkin" }
      });

      if (!isFlex) {
        const notifyAfter = computeNotifyAfter20(new Date(at));
        await upsertIncident({
          userId,
          workdayId: wd.id,
          code: "NO_CHECKIN_MANUAL_CHECKOUT",
          message: "Checkout without check-in. Manual check-in was added.",
          severity: "warn",
          occurredAt: at,
          notifyAfter
        });
      }
    }
  }

  await pool.query("UPDATE workday SET checkout_at=?, checkout_status=? WHERE id=?", [at, status, wd.id]);
  await addEvent({ userId, workdayId: wd.id, type: "checkout", at, status, meta: isFlex ? { flex: true } : null });

  await recalcWorkdayTotals(wd.id);
  return { ok: true, flex: isFlex };
}

export async function startLunch({ userId, at = new Date(), status = "normal" }) {
  const day = at.toISOString().slice(0, 10);
  const [[wd]] = await pool.query("SELECT * FROM workday WHERE user_id=? AND day_date=?", [userId, day]);
  const { isFlex } = await getRuleProfile(userId);
  if (!wd?.checkin_at) return { ok: false, error: "Must check in first" };
  if (wd.lunch_start && !isFlex) return { ok: false, error: "Lunch already started" };

  const checkinAt = new Date(wd.checkin_at);
  const minStart = new Date(checkinAt.getTime() + 60 * 60000);
  if (!isFlex && at < minStart) return { ok: false, error: "Lunch can start only 1 hour after check-in" };

  if (wd.checkout_at && !isFlex) {
    const checkoutAt = new Date(wd.checkout_at);
    const latest = new Date(checkoutAt.getTime() - 2 * 60 * 60000);
    if (at > latest) return { ok: false, error: "Lunch must start at least 2 hours before checkout" };
  }

  await pool.query("UPDATE workday SET lunch_start=?, lunch_status=? WHERE id=?", [at, status, wd.id]);
  await addEvent({ userId, workdayId: wd.id, type: "lunch_start", at, status, meta: isFlex ? { flex: true } : null });
  await recalcWorkdayTotals(wd.id);

  return { ok: true };
}

export async function endLunch({ userId, at = new Date(), status = "normal" }) {
  const day = at.toISOString().slice(0, 10);
  const [[wd]] = await pool.query("SELECT * FROM workday WHERE user_id=? AND day_date=?", [userId, day]);
  const { isFlex } = await getRuleProfile(userId);
  if (!wd?.lunch_start) return { ok: false, error: "Lunch not started" };
  if (wd.lunch_end && !isFlex) return { ok: false, error: "Lunch already ended" };

  const start = new Date(wd.lunch_start);
  const mins = clampMin(minutesDiff(start, at));
  if (!isFlex && mins > RULES.LUNCH_MAX_MIN) {
    const notifyAfter = computeNotifyAfter20(new Date(at));
    await upsertIncident({
      userId,
      workdayId: wd.id,
      code: "LUNCH_EXCEED_60",
      message: `Lunch exceeded 60 min (${mins}). Compensation applies.`,
      severity: "warn",
      occurredAt: at,
      notifyAfter
    });
  }

  await pool.query("UPDATE workday SET lunch_end=? WHERE id=?", [at, wd.id]);
  await addEvent({ userId, workdayId: wd.id, type: "lunch_end", at, status, meta: isFlex ? { flex: true, durationMin: mins } : null });

  await recalcWorkdayTotals(wd.id);
  return { ok: true };
}

export async function startMiniBreak({ userId, at = new Date(), status = "normal" }) {
  const day = at.toISOString().slice(0, 10);
  const [[wd]] = await pool.query("SELECT * FROM workday WHERE user_id=? AND day_date=?", [userId, day]);
  const { isFlex } = await getRuleProfile(userId);
  if (!wd?.checkin_at) return { ok: false, error: "Must check in first" };

  const [existingMini] = await pool.query("SELECT start_at FROM mini_break WHERE workday_id=?", [wd.id]);
  const miniCount = existingMini.length;

  const dayDate = new Date(`${day}T00:00:00`);
  const lunchBoundary = wd.lunch_start ? new Date(wd.lunch_start) : setTimeOnDate(dayDate, RULES.LUNCH_WINDOW_START);

  const beforeCount = existingMini.filter((row) => new Date(row.start_at) < lunchBoundary).length;
  const afterCount = miniCount - beforeCount;

  const atDate = new Date(at);
  const isBeforeLunch = atDate < lunchBoundary;
  const phase = isBeforeLunch ? "before_lunch" : "after_lunch";

  const enforceStructure = !isFlex && miniCount < RULES.MINI_BREAK_MAX_PER_DAY;

  if (enforceStructure) {
    if (isBeforeLunch) {
      if (beforeCount >= RULES.MINI_BREAK_BEFORE_LIMIT) {
        return { ok: false, error: "Mini-break limit reached before lunch (max 2)." };
      }
    } else {
      const afterLimit = beforeCount >= RULES.MINI_BREAK_BEFORE_LIMIT ? RULES.MINI_BREAK_AFTER_DEFAULT : 2;
      if (afterCount >= afterLimit) {
        return { ok: false, error: "Mini-break limit reached after lunch." };
      }
    }
  }

  if (miniCount >= RULES.MINI_BREAK_MAX_PER_DAY) {
    if (!isFlex) {
      const notifyAfter = computeNotifyAfter20(new Date(at));
      await upsertIncident({
        userId,
        workdayId: wd.id,
        code: "MINI_BREAK_OVER_3",
        message: "More than 3 mini-breaks requested. Extra time must be compensated 1:3 after work.",
        severity: "warn",
        occurredAt: at,
        notifyAfter
      });
    }
  }

  const [open] = await pool.query("SELECT id FROM mini_break WHERE workday_id=? AND end_at IS NULL", [wd.id]);
  if (open.length && !isFlex) return { ok: false, error: "Mini-break already running" };

  const [ins] = await pool.query(
    "INSERT INTO mini_break(user_id, workday_id, start_at, status) VALUES(?,?,?,?)",
    [userId, wd.id, at, status]
  );
  await addEvent({
    userId,
    workdayId: wd.id,
    type: "mini_break_start",
    at,
    status,
    meta: { miniBreakId: ins.insertId, phase, flex: isFlex || undefined }
  });

  const notice =
    miniCount >= RULES.MINI_BREAK_MAX_PER_DAY && !isFlex
      ? "Mini-break approved, but extra time must be compensated 1:3 pas orarit të punës."
      : null;

  return { ok: true, miniBreakId: ins.insertId, miniCountBefore: miniCount, phase, notice };
}

export async function endMiniBreak({ userId, at = new Date(), status = "normal" }) {
  const day = at.toISOString().slice(0, 10);
  const [[wd]] = await pool.query("SELECT * FROM workday WHERE user_id=? AND day_date=?", [userId, day]);
  if (!wd) return { ok: false, error: "No workday found" };
  const { isFlex } = await getRuleProfile(userId);

  const [[open]] = await pool.query(
    "SELECT * FROM mini_break WHERE workday_id=? AND end_at IS NULL ORDER BY id DESC LIMIT 1",
    [wd.id]
  );
  if (!open) return { ok: false, error: "No mini-break running" };

  const start = new Date(open.start_at);
  const mins = clampMin(minutesDiff(start, at));
  const exceeded = isFlex ? 0 : clampMin(mins - RULES.MINI_BREAK_MAX_MIN);

  await pool.query(
    "UPDATE mini_break SET end_at=?, duration_minutes=?, exceeded_minutes=?, status=? WHERE id=?",
    [at, mins, exceeded, status, open.id]
  );
  await addEvent({
    userId,
    workdayId: wd.id,
    type: "mini_break_end",
    at,
    status,
    meta: { durationMin: mins, exceededMin: exceeded, flex: isFlex || undefined }
  });

  if (!isFlex && exceeded > 0) {
    const notifyAfter = computeNotifyAfter20(new Date(at));
    await upsertIncident({
      userId,
      workdayId: wd.id,
      code: "MINI_BREAK_EXCEED_7",
      message: `Mini-break exceeded 7 min by ${exceeded} min. Compensation: ${exceeded * RULES.COMP_RATIO} min.`,
      severity: "warn",
      occurredAt: at,
      notifyAfter
    });
  }

  const totals = await recalcWorkdayTotals(wd.id);

  if (!isFlex && totals.exceededTotal > 0) {
    const notifyAfter = computeNotifyAfter20(new Date(at));
    await upsertIncident({
      userId,
      workdayId: wd.id,
      code: "BREAK_EXCEED_60",
      message: `Total breaks exceeded 60 min by ${totals.exceededTotal} min. Compensation applies.`,
      severity: "warn",
      occurredAt: at,
      notifyAfter
    });
  }

  return { ok: true, durationMin: mins, exceededMin: exceeded, totals };
}

export async function applyAutoRulesForDay(userId, dayDateStr) {
  const { isFlex } = await getRuleProfile(userId);
  if (isFlex) return;

  const [[wd]] = await pool.query("SELECT * FROM workday WHERE user_id=? AND day_date=?", [userId, dayDateStr]);
  if (!wd) return;

  const dayDate = new Date(`${dayDateStr}T00:00:00`);

  if (!wd.lunch_start && !wd.lunch_end) {
    const lunchStart = setTimeOnDate(dayDate, RULES.LUNCH_WINDOW_START);
    const lunchEnd = setTimeOnDate(dayDate, RULES.LUNCH_WINDOW_END);

    await pool.query(
      "UPDATE workday SET lunch_start=?, lunch_end=?, lunch_status='auto' WHERE id=?",
      [lunchStart, lunchEnd, wd.id]
    );
    await addEvent({ userId, workdayId: wd.id, type: "lunch_start", at: lunchStart, status: "auto", meta: { auto: true } });
    await addEvent({ userId, workdayId: wd.id, type: "lunch_end", at: lunchEnd, status: "auto", meta: { auto: true } });

    const notifyAfter = computeNotifyAfter20(new Date());
    await upsertIncident({
      userId,
      workdayId: wd.id,
      code: "AUTO_LUNCH",
      message: "Lunch auto-registered (12:00–13:00) because it was not used.",
      severity: "info",
      occurredAt: new Date(),
      notifyAfter
    });
  }

  if (!wd.checkout_at) {
    const autoCheckout = setTimeOnDate(dayDate, RULES.CHECKOUT_AUTO_AT);
    await pool.query("UPDATE workday SET checkout_at=?, checkout_status='auto' WHERE id=?", [autoCheckout, wd.id]);
    await addEvent({ userId, workdayId: wd.id, type: "checkout", at: autoCheckout, status: "auto", meta: { auto: true } });

    const notifyAfter = computeNotifyAfter20(new Date());
    await upsertIncident({
      userId,
      workdayId: wd.id,
      code: "AUTO_CHECKOUT",
      message: "Checkout auto-registered at 17:00.",
      severity: "info",
      occurredAt: new Date(),
      notifyAfter
    });
  }

  await recalcWorkdayTotals(wd.id);
}

export async function getEmployeeDaySummary(userId, dayDateStr) {
  const [[userRow]] = await pool.query(
    "SELECT id,email,role,full_name FROM users WHERE id=? LIMIT 1",
    [userId]
  );

  const user = userRow
    ? {
        id: userRow.id,
        email: userRow.email,
        role: userRow.role,
        name: userRow.full_name || userRow.email,
        full_name: userRow.full_name || userRow.email
      }
    : {
        id: userId,
        name: `Employee #${userId}`,
        full_name: `Employee #${userId}`
      };

  const [[wd]] = await pool.query(
    "SELECT * FROM workday WHERE user_id=? AND day_date=?",
    [userId, dayDateStr]
  );

  if (!wd) {
    return { user, workday: null, events: [], miniBreakCount: 0 };
  }

  const [events] = await pool.query(
    "SELECT event_type,event_at,status,meta FROM attendance_event WHERE workday_id=? ORDER BY event_at ASC",
    [wd.id]
  );

  const [[mbCnt]] = await pool.query(
    "SELECT COUNT(*) AS c FROM mini_break WHERE workday_id=?",
    [wd.id]
  );

  return { user, workday: wd, events, miniBreakCount: Number(mbCnt.c) };
}

export async function adminLiveOverview(dayDateStr) {
  const [rows] = await pool.query(
    `SELECT 
        u.*,
        w.id AS workday_id,
        w.checkin_at,
        w.checkout_at,
        w.lunch_start,
        w.lunch_end
     FROM users u
     LEFT JOIN workday w ON w.user_id=u.id AND w.day_date=?
     WHERE u.role='EMPLOYEE' AND COALESCE(u.is_active,1)=1`,
    [dayDateStr]
  );

  const groups = { not_checked_in: [], active: [], lunch: [], mini_break: [], checked_out: [] };

  for (const r of rows) {
    const entry = {
      ...r,
      user_id: r.id,
      full_name: r.full_name || r.name || r.email
    };

    if (!r.checkin_at && !r.checkout_at) {
      groups.not_checked_in.push(entry);
    } else if (r.checkout_at) {
      groups.checked_out.push(entry);
    } else if (r.lunch_start && !r.lunch_end) {
      groups.lunch.push(entry);
    }
    else {
      if (r.workday_id) {
        const [[openMb]] = await pool.query(
          "SELECT id FROM mini_break WHERE workday_id=? AND end_at IS NULL LIMIT 1",
          [r.workday_id]
        );
        if (openMb) {
          groups.mini_break.push(entry);
          continue;
        }
      }
      groups.active.push(entry);
    }
  }

  return groups;
}
