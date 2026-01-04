import dotenv from "dotenv";
import path from "path";
import url from "url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { pool } from "../src/config/db.js";

const [rows] = await pool.query("DESCRIBE users");
console.log(rows);
await pool.end();
