import dotenv from "dotenv";
import path from "path";
import url from "url";
import bcrypt from "bcrypt";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { pool } from "../src/config/db.js";

async function setSecretsByEmail(email, password, pin) {
  const updates = [];
  const values = [];
  if (password) {
    const hash = await bcrypt.hash(password, 10);
    updates.push("password_hash=?");
    values.push(hash);
  }
  if (pin) {
    const hash = await bcrypt.hash(String(pin), 10);
    updates.push("pin_hash=?");
    values.push(hash);
  }
  values.push(email);
  await pool.query(`UPDATE users SET ${updates.join(", ")} WHERE email=?`, values);
}

async function ensureEmployeeActiveByEmail(email) {
  await pool.query("UPDATE users SET role='EMPLOYEE', is_active=1 WHERE email=?", [email]);
}

async function run() {
  // Ensure desired records are active by email
  await ensureEmployeeActiveByEmail("rakovicaberat@gmail.com");
  await ensureEmployeeActiveByEmail("kimibishiphotography@gmail.com");
  await ensureEmployeeActiveByEmail("erionakqiu@gmail.com");
  await ensureEmployeeActiveByEmail("suela.nallbania@gmail.com");
  // If Murati email differs, update below accordingly
  await ensureEmployeeActiveByEmail("murati@example.com");

  // Keep archived duplicates inactive
  await pool.query(
    "UPDATE users SET is_active=0 WHERE full_name IN (?, ?) AND email LIKE '%.old_%'",
    ["Berat Rakovica", "Shkelqim Ibishi"]
  );

  // Set default secrets
  await setSecretsByEmail("rakovicaberat@gmail.com", "Emp123!", 1234);
  await setSecretsByEmail("kimibishiphotography@gmail.com", "Emp123!", 1234);
  await setSecretsByEmail("erionakqiu@gmail.com", "Emp123!", 1234);
  await setSecretsByEmail("suela.nallbania@gmail.com", "Emp123!", 1234);
  await setSecretsByEmail("murati@example.com", "Emp123!", 1234);

  console.log("Default secrets set for Berat, Shkelqim, Eriona, Suela, and Murati.");
  await pool.end();
}

run().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
