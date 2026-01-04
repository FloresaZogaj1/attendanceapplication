import { pool } from "../config/db.js";

export async function sendIncident(inc) {
  // TODO: hook up email / whatsapp provider
  console.log("SEND INCIDENT:", inc.code, inc.message, "to user:", inc.user_id);
  await pool.query("UPDATE incident SET notified_at=NOW() WHERE id=?", [inc.id]);
}
