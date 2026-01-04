import { pool } from "../config/db.js";
import { setTimeOnDate, minutesDiff, clampMin } from "../utils/time.js";

function formatDateLocal(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function ensureDate(dateStr) {
  if (!dateStr) throw new Error("Date is required");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) throw new Error("Invalid date");
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) throw new Error("Invalid date");
  return { date: d, iso: dateStr };
}

function ensureAnchor(anchor) {
  if (!anchor) throw new Error("Anchor date is required");
  const d = new Date(`${anchor}T00:00:00`);
  if (Number.isNaN(d.getTime())) throw new Error("Invalid anchor date");
  return d;
}

async function getEmployeeBasic(userId) {
  const [[user]] = await pool.query(
    "SELECT id, full_name, email, phone, COALESCE(is_active,1) AS is_active FROM users WHERE id=? AND role='EMPLOYEE'",
    [userId]
  );
  if (!user) throw new Error("Employee not found");
  return { ...user, is_active: Boolean(user.is_active) };
}

function computeWorkedMinutes(workday) {
  if (!workday?.checkin_at || !workday?.checkout_at) return 0;
  const checkin = new Date(workday.checkin_at);
  const checkout = new Date(workday.checkout_at);
  const gross = clampMin(minutesDiff(checkin, checkout));
  return clampMin(gross - Number(workday.break_total_minutes || 0));
}

function computeOvertime(workday, workedMinutes) {
  if (!workday) return 0;
  const baseDate = new Date(`${workday.day_date}T00:00:00`);
  const start = setTimeOnDate(baseDate, workday.scheduled_start || "09:00:00");
  const end = setTimeOnDate(baseDate, workday.scheduled_end || "17:00:00");
  const scheduled = clampMin(minutesDiff(start, end));
  return clampMin(workedMinutes - scheduled);
}

function parseMeta(meta) {
  if (!meta) return null;
  if (typeof meta === "object") return meta;
  try {
    return JSON.parse(meta);
  } catch {
    return null;
  }
}

const EVENT_LABELS = {
  checkin: "Checked In",
  checkout: "Checked Out",
  lunch_start: "Lunch Break Start",
  lunch_end: "Lunch Break End",
  mini_break_start: "Mini Break Start",
  mini_break_end: "Mini Break End",
  note: "Note"
};

export async function getEmployeeDayTimeline(userId, dateStr) {
  const user = await getEmployeeBasic(userId);
  const { iso: dayIso } = ensureDate(dateStr);

  const [[workday]] = await pool.query(
    "SELECT * FROM workday WHERE user_id=? AND day_date=?",
    [userId, dayIso]
  );

  if (!workday) {
    return {
      user,
      timeline: [],
      summary: {
        workedMinutes: 0,
        breakMinutes: 0,
        overtimeMinutes: 0,
        compensationMinutes: 0,
        compensationWorkMinutes: 0,
        miniBreakCount: 0
      },
      incidents: []
    };
  }

  const [events] = await pool.query(
    "SELECT event_type,event_at,status,meta FROM attendance_event WHERE workday_id=? ORDER BY event_at ASC",
    [workday.id]
  );

  const timeline = events.map((evt) => ({
    at: evt.event_at,
    type: evt.event_type,
    status: evt.status,
    label: EVENT_LABELS[evt.event_type] || evt.event_type,
    meta: parseMeta(evt.meta)
  }));

  const [[miniCountRow]] = await pool.query(
    "SELECT COUNT(*) AS cnt FROM mini_break WHERE workday_id=?",
    [workday.id]
  );

  const workedMinutes = computeWorkedMinutes(workday);
  const summary = {
    workedMinutes,
    breakMinutes: Number(workday.break_total_minutes || 0),
    overtimeMinutes: computeOvertime(workday, workedMinutes),
    compensationMinutes: Number(workday.compensation_minutes || 0),
    compensationWorkMinutes: Number(workday.compensation_work_minutes || 0),
    miniBreakCount: Number(miniCountRow.cnt || 0)
  };

  const [incidents] = await pool.query(
    "SELECT id, code, message, severity, occurred_at FROM incident WHERE workday_id=? ORDER BY occurred_at ASC",
    [workday.id]
  );

  return { user, workday, timeline, summary, incidents };
}

function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfWeek(date) {
  const start = startOfWeek(date);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return end;
}

function startOfMonth(date) {
  const d = new Date(date);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfMonth(date) {
  const start = startOfMonth(date);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  end.setDate(0);
  end.setHours(0, 0, 0, 0);
  return end;
}

export async function getEmployeeAggregate(userId, { range = "week", anchor }) {
  await getEmployeeBasic(userId); // ensure exists
  const anchorDate = ensureAnchor(anchor);
  const anchorIso = anchor || formatDateLocal(anchorDate);

  let from;
  let to;

  if (range === "month") {
    from = startOfMonth(anchorDate);
    to = endOfMonth(anchorDate);
  } else {
    from = startOfWeek(anchorDate);
    to = endOfWeek(anchorDate);
  }

  const fromIso = formatDateLocal(from);
  const toIso = formatDateLocal(to);

  const [workdays] = await pool.query(
    "SELECT * FROM workday WHERE user_id=? AND day_date BETWEEN ? AND ? ORDER BY day_date ASC",
    [userId, fromIso, toIso]
  );

  if (!workdays.length) {
    return {
      range,
      anchor: anchorIso,
      days: [],
      totals: {
        workedMinutes: 0,
        breakMinutes: 0,
        overtimeMinutes: 0,
        compensationMinutes: 0,
        miniBreakCount: 0,
        incidents: 0
      }
    };
  }

  const workdayIds = workdays.map((w) => w.id);
  const placeholders = workdayIds.map(() => "?").join(",");

  const [miniCounts] = await pool.query(
    `SELECT w.day_date AS day, COUNT(mb.id) AS cnt
       FROM workday w
       LEFT JOIN mini_break mb ON mb.workday_id=w.id
      WHERE w.id IN (${placeholders})
      GROUP BY w.day_date`,
    workdayIds
  );

  const miniMap = Object.fromEntries(
    miniCounts.map((row) => [formatDateLocal(row.day), Number(row.cnt || 0)])
  );

  const [incidentCounts] = await pool.query(
    `SELECT w.day_date AS day, COUNT(i.id) AS cnt
       FROM workday w
       LEFT JOIN incident i ON i.workday_id=w.id
      WHERE w.id IN (${placeholders})
      GROUP BY w.day_date`,
    workdayIds
  );

  const incidentMap = Object.fromEntries(
    incidentCounts.map((row) => [formatDateLocal(row.day), Number(row.cnt || 0)])
  );

  const days = [];
  const totals = {
    workedMinutes: 0,
    breakMinutes: 0,
    overtimeMinutes: 0,
    compensationMinutes: 0,
    miniBreakCount: 0,
    incidents: 0
  };

  for (const wd of workdays) {
    const workedMinutes = computeWorkedMinutes(wd);
    const overtimeMinutes = computeOvertime(wd, workedMinutes);
    const breakMinutes = Number(wd.break_total_minutes || 0);
    const compMinutes = Number(wd.compensation_minutes || 0);
    const dayKey = formatDateLocal(wd.day_date);
    const miniCount = miniMap[dayKey] || 0;
    const incidentCount = incidentMap[dayKey] || 0;

    days.push({
      day: dayKey,
      workedMinutes,
      breakMinutes,
      overtimeMinutes,
      compensationMinutes: compMinutes,
      miniBreakCount: miniCount,
      incidents: incidentCount
    });

    totals.workedMinutes += workedMinutes;
    totals.breakMinutes += breakMinutes;
    totals.overtimeMinutes += overtimeMinutes;
    totals.compensationMinutes += compMinutes;
    totals.miniBreakCount += miniCount;
    totals.incidents += incidentCount;
  }

  return {
    range,
    anchor: anchorIso,
    from: fromIso,
    to: toIso,
    days,
    totals
  };
}

export async function getEmployeeIncidents(userId, { from, to, severity }) {
  await getEmployeeBasic(userId);

  const clauses = ["user_id=?"];
  const params = [userId];

  if (from) {
    const { iso } = ensureDate(from);
    clauses.push("DATE(occurred_at) >= ?");
    params.push(iso);
  }
  if (to) {
    const { iso } = ensureDate(to);
    clauses.push("DATE(occurred_at) <= ?");
    params.push(iso);
  }
  if (severity) {
    clauses.push("severity=?");
    params.push(severity);
  }

  const [rows] = await pool.query(
    `SELECT id, workday_id, code, message, severity, occurred_at, notify_after, notified_at
       FROM incident
      WHERE ${clauses.join(" AND ")}
      ORDER BY occurred_at DESC` ,
    params
  );

  return { items: rows, meta: { count: rows.length } };
}

function formatCsvValue(value) {
  if (value == null) return "";
  const str = String(value);
  if (str.includes(",") || str.includes("\"") || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function buildMonthlyReportCsv(userId, { month, format }) {
  if (!month) throw new Error("Month is required");
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Invalid month format");
  const fmt = (format || "csv").toLowerCase();
  if (fmt !== "csv") throw new Error("Only CSV format is supported");

  const user = await getEmployeeBasic(userId);
  const [year, mon] = month.split("-").map((n) => Number(n));
  const start = new Date(Date.UTC(year, mon - 1, 1));
  const end = new Date(Date.UTC(year, mon, 0));
  const fromIso = formatDateLocal(start);
  const toIso = formatDateLocal(end);

  const { days } = await getEmployeeAggregate(userId, { range: "month", anchor: `${month}-01` });

  const workdayIdsQuery = await pool.query(
    "SELECT id, day_date, checkin_at, checkout_at FROM workday WHERE user_id=? AND day_date BETWEEN ? AND ?",
    [userId, fromIso, toIso]
  );
  const [workdayRows] = workdayIdsQuery;
  const idByDay = Object.fromEntries(workdayRows.map((wd) => [formatDateLocal(wd.day_date), wd.id]));

  const [incidentRowsAll] = await pool.query(
    `SELECT DATE(occurred_at) AS day, GROUP_CONCAT(code ORDER BY occurred_at SEPARATOR '; ') AS codes
       FROM incident
      WHERE user_id=? AND DATE(occurred_at) BETWEEN ? AND ?
      GROUP BY DATE(occurred_at)`,
    [userId, fromIso, toIso]
  );

  const incidentMap = Object.fromEntries(
    incidentRowsAll.map((row) => [formatDateLocal(row.day), row.codes || ""])
  );

  let csv = "Date,Check-in,Checkout,Worked Minutes,Break Minutes,Overtime Minutes,Mini-Breaks,Incidents,Compensation Minutes\n";

  for (const day of days) {
    const dayKey = typeof day.day === "string" ? day.day : formatDateLocal(day.day);
    const wdId = idByDay[dayKey];
    let checkin = "";
    let checkout = "";
    if (wdId) {
      const wd = workdayRows.find((w) => w.id === wdId);
      if (wd?.checkin_at) {
        checkin = new Date(wd.checkin_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
      }
      if (wd?.checkout_at) {
        checkout = new Date(wd.checkout_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
      }
    }

    const incidentCodes = incidentMap[dayKey] || "";

    const row = [
      formatCsvValue(dayKey),
      formatCsvValue(checkin),
      formatCsvValue(checkout),
      formatCsvValue(day.workedMinutes),
      formatCsvValue(day.breakMinutes),
      formatCsvValue(day.overtimeMinutes),
      formatCsvValue(day.miniBreakCount),
      formatCsvValue(incidentCodes),
      formatCsvValue(day.compensationMinutes)
    ];

    csv += row.join(",") + "\n";
  }

  return { user, month, csv };
}