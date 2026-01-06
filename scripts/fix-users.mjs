import dotenv from "dotenv";
import path from "path";
import url from "url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { pool } from "../src/config/db.js";

async function run() {
  // 1) Deactivate Sarah Miller instead of delete (safer with FKs)
  await pool.query("UPDATE users SET is_active=0 WHERE full_name=?", ["Sarah Miller"]);

  // 2) Ensure Berat email is gmail
  // If someone else already uses that email, archive their email to free it up
  await pool.query(
    "UPDATE users SET email=CONCAT(email, '.old_', id) WHERE email=? AND full_name<>?",
    ["rakovicaberat@gmail.com", "Berat Rakovica"]
  );
  await pool.query("UPDATE users SET email=? WHERE full_name=?", [
    "rakovicaberat@gmail.com",
    "Berat Rakovica"
  ]);

  // 3) For Shkelqim: deactivate worktrack.local entry if present and keep gmail
  await pool.query(
    "UPDATE users SET is_active=0, email=CONCAT(email, '.old_', id) WHERE full_name=? AND email=?",
    ["Shkelqim Ibishi", "shkelqim@worktrack.local"]
  );

  // 4) Ensure one Shkelqim gmail exists; if not, insert
  const [rows] = await pool.query(
    "SELECT id FROM users WHERE full_name=? AND email=? LIMIT 1",
    ["Shkelqim Ibishi", "kimibishiphotography@gmail.com"]
  );
  if (!rows.length) {
    await pool.query(
      "INSERT INTO users(full_name,email,password_hash,role) VALUES(?,?,?,?)",
      [
        "Shkelqim Ibishi",
        "kimibishiphotography@gmail.com",
        "$2b$10$PLACEHOLDER",
        "EMPLOYEE"
      ]
    );
  }

  console.log("Fixes applied.");
  await pool.end();
}

run().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
