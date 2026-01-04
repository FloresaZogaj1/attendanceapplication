const url = process.argv[2] || "http://localhost:5050/health";

try {
  const res = await fetch(url);
  const body = await res.text();
  console.log("Status:", res.status);
  console.log("Body:", body);
} catch (err) {
  console.error("Health check failed:", err.message);
  process.exitCode = 1;
}
