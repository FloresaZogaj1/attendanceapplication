import dotenv from "dotenv";
import path from "path";
import url from "url";
import bcrypt from "bcrypt";
import fs from "fs";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { pool } from "../src/config/db.js";

async function runSql(file) {
  const sql = fs.readFileSync(file, "utf8");
  const statements = sql.split(/;\s*$/m).map((s) => s.trim()).filter(Boolean);
  for (const st of statements) {
    try {
      await pool.query(st);
    } catch (err) {
      if (["ER_DB_CREATE_EXISTS", "ER_TABLE_EXISTS_ERROR", "ER_DUP_ENTRY", "ER_BAD_FIELD_ERROR"].includes(err.code)) {
        console.warn("SQL warning:", err.code, err.message);
        continue;
      }
      throw err;
    }
  }
}

async function ensureUser(full_name, email, password, pin) {
  const [[existing]] = await pool.query("SELECT id,is_active FROM users WHERE email=? LIMIT 1", [email]);
  if (!existing) {
    await pool.query(
      "INSERT INTO users(full_name,email,password_hash,role,is_active) VALUES(?,?,?,?,1)",
      [full_name, email, "$2b$10$PLACEHOLDER", "EMPLOYEE"]
    );
  }
  // Activate and set secrets
  const updates = [];
  const values = [];
  if (password) {
    const ph = await bcrypt.hash(password, 10);
    updates.push("password_hash=?");
    values.push(ph);
  }
  if (pin) {
    const p = await bcrypt.hash(String(pin), 10);
    updates.push("pin_hash=?", "pin_enabled=1");
    values.push(p);
  }
  updates.push("is_active=1", "role='EMPLOYEE'");
  values.push(email);
  await pool.query(`UPDATE users SET ${updates.join(",")} WHERE email=?`, values);
}

async function main() {
  // 1) Ensure schema is applied (idempotent)
  const dbDir = path.resolve(__dirname, "../../db");
  await runSql(path.join(dbDir, "001_schema.sql"));
  await runSql(path.join(dbDir, "003_add_flex_mode.sql"));

  // 2) Ensure known employees exist and have secrets
  await ensureUser("Berat Rakovica", "rakovicaberat@gmail.com", "Emp123!", 1234);
  await ensureUser("Shkelqim Ibishi", "kimibishiphotography@gmail.com", "Emp123!", 1234);
  await ensureUser("Eriona Kqiku", "erionakqiu@gmail.com", "Emp123!", 1234);
  await ensureUser("Suela Nallbani", "suela.nallbania@gmail.com", "Emp123!", 1234);
  // TODO: Replace with actual email for Murati before running in prod
  await ensureUser("Murati", "murati@example.com", "Emp123!", 1234);

  console.log("Production bootstrap complete.");
}

main()
  .catch((e) => {
    console.error("Bootstrap failed:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
