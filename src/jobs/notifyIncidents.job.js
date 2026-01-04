import cron from "node-cron";
import { pool } from "../config/db.js";
import { sendIncident } from "../services/notify.service.js";

export function startNotifyJob() {
  // run every 10 minutes after 20:00
  cron.schedule("*/10 20-23 * * *", async () => {
    const [incs] = await pool.query(
      "SELECT * FROM incident WHERE notified_at IS NULL AND notify_after <= NOW() ORDER BY notify_after ASC LIMIT 50"
    );
    for (const inc of incs) {
      await sendIncident(inc);
    }
    if (incs.length) console.log("[notify] sent", incs.length);
  });
}
