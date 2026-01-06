import dotenv from "dotenv";
import path from "path";
import url from "url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { pool } from "../src/config/db.js";

const includeInactive = process.env.INCLUDE_INACTIVE === "true";

const [rows] = await pool.query(
  `SELECT id, full_name, email, role, COALESCE(is_active,1) AS is_active, COALESCE(flex_mode,0) AS flex_mode
     FROM users
    WHERE role='EMPLOYEE' ${includeInactive ? '' : 'AND COALESCE(is_active,1)=1'}
    ORDER BY full_name`
);
console.table(rows);
await pool.end();
