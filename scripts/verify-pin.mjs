import path from "path";
import url from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { pool } from "../src/config/db.js";
import bcrypt from "bcrypt";

const email = process.argv[2];
const pin = process.argv[3];

if (!email || !pin) {
  console.log("Usage: node scripts/verify-pin.mjs <email> <pin>");
  process.exit(1);
}

const [[user]] = await pool.query("SELECT pin_hash FROM users WHERE email=?", [email]);
if (!user) {
  console.error("User not found");
  process.exit(1);
}

if (!user.pin_hash) {
  console.error("pin_hash missing for user");
  process.exit(1);
}

const ok = await bcrypt.compare(pin, user.pin_hash);
console.log("Match:", ok);
await pool.end();
