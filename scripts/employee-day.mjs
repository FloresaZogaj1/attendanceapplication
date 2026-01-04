import path from "path";
import url from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const email = process.argv[2];
const pin = process.argv[3];
if (!email || !pin) {
  console.error("Usage: node scripts/employee-day.mjs <email> <pin> [date]");
  process.exit(1);
}

const date = process.argv[4] || new Date().toISOString().slice(0, 10);

async function login() {
  const res = await fetch("http://localhost:5050/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, pin })
  });
  if (!res.ok) {
    throw new Error(`Login failed with status ${res.status}`);
  }
  return res.json();
}

async function main() {
  const { token } = await login();
  const res = await fetch(`http://localhost:5050/api/employee/me/day?date=${date}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const body = await res.text();
  console.log(res.status, body);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
