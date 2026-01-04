import { pool } from "../config/db.js";
import { toDateOnly, setTimeOnDate, minutesDiff, clampMin } from "../utils/time.js";

export async function getOrCreateWorkday(userId, dateObj) {
  const day = toDateOnly(dateObj);
  const [rows] = await pool.query(
    "SELECT * FROM workday WHERE user_id=? AND day_date=?",
    [userId, day]
  );
  if (rows.length) return rows[0];

  await pool.query(
    "INSERT INTO workday(user_id, day_date) VALUES(?,?)",
    [userId, day]
  );
  const [[created]] = await pool.query(
    "SELECT * FROM workday WHERE user_id=? AND day_date=?",
    [userId, day]
  );
  return created;
}

export async function addEvent({ userId, workdayId, type, at, status = "normal", meta = null }) {
  await pool.query(
    "INSERT INTO attendance_event(user_id, workday_id, event_type, event_at, status, meta) VALUES(?,?,?,?,?,?)",
    [userId, workdayId, type, at, status, meta ? JSON.stringify(meta) : null]
  );
}

export async function upsertIncident({
  userId,
  workdayId,
  code,
  message,
  severity = "warn",
  occurredAt,
  notifyAfter,
  channel = "both"
}) {
  // prevent duplicates per day+code
  const [rows] = await pool.query(
    "SELECT id FROM incident WHERE user_id=? AND workday_id=? AND code=?",
    [userId, workdayId, code]
  );
  if (rows.length) return;

  await pool.query(
    "INSERT INTO incident(user_id, workday_id, code, message, severity, occurred_at, notify_after, channel) VALUES(?,?,?,?,?,?,?,?)",
    [userId, workdayId, code, message, severity, occurredAt, notifyAfter, channel]
  );
}

export function computeNotifyAfter20(occurredAt) {
  const d = new Date(occurredAt);
  d.setHours(20, 0, 0, 0);
  // If incident happens after 20:00, notify next day 20:00.
  if (occurredAt > d) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

export function calcLateMinutes(checkinAt, ruleCutoff = "09:05:00") {
  const cutoff = setTimeOnDate(checkinAt, ruleCutoff);
  return clampMin(minutesDiff(cutoff, checkinAt));
}
