import "../src/server.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  const email = process.env.DEMO_EMAIL || "admin@example.com";
  const secret = process.env.DEMO_PIN || "688967";

  await sleep(800);

  try {
    const res = await fetch("http://localhost:5050/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, pin: secret })
    });

    const body = await res.text();
    console.log("Status:", res.status, res.statusText);
    console.log("Body:", body);
  } catch (err) {
    console.error("Request failed:", err.message);
  } finally {
    await sleep(200);
    process.exit(0);
  }
}

run();
