import cron from "node-cron";
import { pool } from "../config/db.js";
import { applyAutoRulesForDay } from "../services/rules.service.js";

export function startAutoRulesJob() {
  // Runs every 5 minutes during 17:00 hour to apply auto rules.
  cron.schedule("*/5 17 * * *", async () => {
    const today = new Date().toISOString().slice(0, 10);

    const [emps] = await pool.query("SELECT id FROM users WHERE role='EMPLOYEE' AND is_active=1");
    for (const e of emps) {
      await applyAutoRulesForDay(e.id, today);
    }
    console.log("[autoRules] applied for", today);
  });
}
