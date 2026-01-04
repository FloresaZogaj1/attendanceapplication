import bcrypt from "bcrypt";
import { pool } from "../config/db.js";

let flexColumnChecked = false;
let flexColumnAvailable = false;

async function ensureFlexColumn() {
  if (flexColumnChecked) return flexColumnAvailable;
  try {
    const [[row]] = await pool.query(
      `SELECT COUNT(*) AS cnt
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'users'
          AND COLUMN_NAME = 'flex_mode'`
    );
    flexColumnAvailable = Number(row?.cnt || 0) > 0;
  } catch (err) {
    console.warn("[admin.service] Failed to detect flex_mode column", err);
    flexColumnAvailable = false;
  }
  if (!flexColumnAvailable) {
    console.warn("[admin.service] flex_mode column missing; run db/003_add_flex_mode.sql to enable flex employees");
  }
  flexColumnChecked = true;
  return flexColumnAvailable;
}

function applySearchFilter(search) {
  if (!search) return { clause: "", params: [] };
  const like = `%${search}%`;
  return {
    clause: "AND (u.full_name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)",
    params: [like, like, like]
  };
}

export async function listEmployees({ search = "", page = 1, pageSize = 20, includeInactive = false }) {
  const safePage = Math.max(Number.isFinite(page) ? page : 1, 1);
  const safePageSize = Math.max(Number.isFinite(pageSize) ? pageSize : 20, 1);
  const offset = (safePage - 1) * safePageSize;

  const { clause, params } = applySearchFilter(search.trim());
  const activeClause = includeInactive ? "" : "AND COALESCE(u.is_active,1)=1";
  const hasFlex = await ensureFlexColumn();
  const flexSelect = hasFlex ? "COALESCE(u.flex_mode,0) AS flex_mode" : "0 AS flex_mode";

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM users u
     WHERE u.role='EMPLOYEE' ${activeClause} ${clause}`,
    params
  );

  const [rows] = await pool.query(
    `SELECT u.id, u.full_name, u.email, u.phone, COALESCE(u.is_active,1) AS is_active, ${flexSelect},
            MAX(w.checkin_at) AS last_checkin,
            MAX(w.checkout_at) AS last_checkout,
            MAX(w.day_date) AS last_day
       FROM users u
       LEFT JOIN workday w ON w.user_id=u.id
      WHERE u.role='EMPLOYEE' ${activeClause} ${clause}
      GROUP BY u.id
      ORDER BY u.full_name
      LIMIT ? OFFSET ?`,
    [...params, safePageSize, offset]
  );

  return {
    items: rows.map((r) => ({
      id: r.id,
      full_name: r.full_name,
      email: r.email,
      phone: r.phone,
      is_active: Boolean(r.is_active),
      role: "EMPLOYEE",
      flex_mode: Boolean(r.flex_mode),
      lastCheckin: r.last_checkin,
      lastCheckout: r.last_checkout,
      lastDay: r.last_day
    })),
    meta: {
      page: safePage,
      pageSize: safePageSize,
      totalItems: total,
      totalPages: Math.ceil(total / safePageSize) || 1
    }
  };
}

export async function getEmployeeById(id) {
  const hasFlex = await ensureFlexColumn();
  const flexSelect = hasFlex ? "COALESCE(flex_mode,0) AS flex_mode" : "0 AS flex_mode";
  const [[row]] = await pool.query(
    `SELECT id, full_name, email, phone, role, COALESCE(is_active,1) AS is_active, ${flexSelect} FROM users WHERE id=? AND role='EMPLOYEE'`,
    [id]
  );
  return row ? { ...row, is_active: Boolean(row.is_active), flex_mode: Boolean(row.flex_mode) } : null;
}

export async function createEmployee({ full_name, email, phone = null, password = null, pin = null, is_active = true, flex_mode = false }) {
  if (!full_name || !email) {
    throw new Error("Full name and email are required");
  }

  if (!password && !pin) {
    throw new Error("Password or pin is required");
  }

  const nameTrim = full_name.trim();
  const emailTrim = email.trim().toLowerCase();
  if (!nameTrim || !emailTrim) throw new Error("Full name and email are required");

  const [[existing]] = await pool.query("SELECT id FROM users WHERE email=? LIMIT 1", [emailTrim]);
  if (existing) throw new Error("Email already in use");

  const baseSecret = password || String(pin);
  const passwordHash = await bcrypt.hash(baseSecret, 10);
  const pinHash = pin ? await bcrypt.hash(String(pin), 10) : null;

  const hasFlex = await ensureFlexColumn();
  const columns = ["full_name", "email", "password_hash", "role", "phone", "is_active", "pin_hash"];
  const placeholders = ["?", "?", "?", "?", "?", "?", "?"];
  const values = [nameTrim, emailTrim, passwordHash, "EMPLOYEE", phone, is_active ? 1 : 0, pinHash];

  if (hasFlex) {
    columns.push("flex_mode");
    placeholders.push("?");
    values.push(flex_mode ? 1 : 0);
  }

  const sql = `INSERT INTO users(${columns.join(",")}) VALUES(${placeholders.join(",")})`;
  const [ins] = await pool.query(sql, values);

  return await getEmployeeById(ins.insertId);
}

export async function updateEmployee(id, { full_name, email, phone, is_active, flex_mode }) {
  const employee = await getEmployeeById(id);
  if (!employee) throw new Error("Employee not found");

  const hasFlex = await ensureFlexColumn();

  const fields = [];
  const values = [];

  if (typeof full_name === "string" && full_name.trim()) {
    fields.push("full_name=?");
    values.push(full_name.trim());
  }
  if (typeof email === "string" && email.trim()) {
    const newEmail = email.trim().toLowerCase();
    const [[exists]] = await pool.query("SELECT id FROM users WHERE email=? AND id<>?", [newEmail, id]);
    if (exists) throw new Error("Email already in use");
    fields.push("email=?");
    values.push(newEmail);
  }
  if (typeof phone !== "undefined") {
    fields.push("phone=?");
    values.push(phone || null);
  }
  if (typeof is_active === "boolean") {
    fields.push("is_active=?");
    values.push(is_active ? 1 : 0);
  }

  if (hasFlex && typeof flex_mode === "boolean") {
    fields.push("flex_mode=?");
    values.push(flex_mode ? 1 : 0);
  }

  if (!fields.length) {
    return employee;
  }

  values.push(id);
  await pool.query(`UPDATE users SET ${fields.join(", ")} WHERE id=? AND role='EMPLOYEE'`, values);
  return await getEmployeeById(id);
}

export async function deleteEmployee(id, { hard = false } = {}) {
  if (hard) {
    await pool.query("DELETE FROM users WHERE id=? AND role='EMPLOYEE'", [id]);
    return { ok: true, deleted: true };
  }

  const [{ affectedRows }] = await pool.query(
    "UPDATE users SET is_active=0 WHERE id=? AND role='EMPLOYEE'",
    [id]
  );
  return { ok: true, disabled: affectedRows > 0 };
}

export async function resetEmployeeSecret(id, { password = null, pin = null }) {
  if (!password && !pin) {
    throw new Error("Provide password or pin");
  }

  const employee = await getEmployeeById(id);
  if (!employee) throw new Error("Employee not found");

  const sets = [];
  const values = [];

  if (password) {
    const hash = await bcrypt.hash(password, 10);
    sets.push("password_hash=?");
    values.push(hash);
  }

  if (pin) {
    const hash = await bcrypt.hash(String(pin), 10);
    sets.push("pin_hash=?");
    values.push(hash);
  }

  values.push(id);
  await pool.query(`UPDATE users SET ${sets.join(", ")} WHERE id=? AND role='EMPLOYEE'`, values);
  return { ok: true };
}