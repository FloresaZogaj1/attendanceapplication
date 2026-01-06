import dotenv from "dotenv";
import path from "path";
import url from "url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
// ensure .env is loaded when running from other CWDs
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { pool } from "../src/config/db.js";

const names = ["Berat Rakovica", "Shkelqim Ibishi"]; 
const [rows] = await pool.query(
  `SELECT id, full_name, email, COALESCE(is_active,1) AS is_active, COALESCE(flex_mode,0) AS flex_mode
     FROM users
    WHERE full_name IN (?, ?)
    ORDER BY full_name`,
  names
);
console.table(rows);
await pool.end();
