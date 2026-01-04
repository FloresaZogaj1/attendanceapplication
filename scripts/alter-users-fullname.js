import mysql from "mysql2/promise";
import "dotenv/config";

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT || 3306)
  });

  try {
    await pool.query("ALTER TABLE users CHANGE COLUMN name full_name VARCHAR(255) NOT NULL");
    console.log("Column 'name' renamed to 'full_name'.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
