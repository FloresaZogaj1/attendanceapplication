const email = process.env.ADMIN_EMAIL || "admin@example.com";
const pin = process.env.ADMIN_PIN || "688967";

async function login() {
  const res = await fetch("http://localhost:5050/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, pin })
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  return res.json();
}

async function adminLive(token) {
  const today = new Date().toISOString().slice(0, 10);
  const res = await fetch(`http://localhost:5050/api/admin/live?date=${today}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const body = await res.text();
  console.log("Status:", res.status);
  console.log(body);
}

try {
  const { token } = await login();
  await adminLive(token);
} catch (err) {
  console.error(err);
  process.exitCode = 1;
}
