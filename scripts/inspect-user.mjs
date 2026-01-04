import { pool } from "../src/config/db.js";

const email = process.argv[2] || "admin@example.com";

const [rows] = await pool.query("SELECT * FROM users WHERE email=?", [email]);
console.log(rows[0] || null);

await pool.end();
