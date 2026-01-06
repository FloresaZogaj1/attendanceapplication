import fs from "fs";
import path from "path";
import url from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { pool } from "../src/config/db.js";

const files = [
  path.resolve(__dirname, "../../db/001_schema.sql"),
  path.resolve(__dirname, "../../db/002_seed.sql"),
  path.resolve(__dirname, "../../db/003_add_flex_mode.sql")
];

async function runSqlFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const statements = content
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const statement of statements) {
    try {
      await pool.query(statement);
    } catch (err) {
  if (err.code === "ER_DB_CREATE_EXISTS" || err.code === "ER_TABLE_EXISTS_ERROR") continue;
  if (err.code === "ER_DUP_ENTRY") continue;
      if (err.code === "ER_BAD_FIELD_ERROR") {
        console.warn(`Skipping statement due to column mismatch: ${err.message}`);
        continue;
      }
      throw new Error(`Failed executing statement from ${path.basename(filePath)}: ${err.message}`);
    }
  }
}

(async () => {
  try {
    for (const file of files) {
      await runSqlFile(file);
      console.log(`Applied ${path.basename(file)}`);
    }
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
