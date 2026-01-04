import "../src/server.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function login() {
  const res = await fetch("http://localhost:5050/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@example.com", pin: "688967" })
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  return res.json();
}

async function adminLive(token) {
  const date = new Date().toISOString().slice(0, 10);
  const res = await fetch(`http://localhost:5050/api/admin/live?date=${date}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return { status: res.status, body: await res.text() };
}

async function run() {
  await sleep(500);
  const { token } = await login();
  const live = await adminLive(token);
  console.log("Admin live status:", live.status);
  console.log(live.body);
  await sleep(100);
  process.exit(0);
}

run();
