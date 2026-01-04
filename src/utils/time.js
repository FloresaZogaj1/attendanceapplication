export function toDateOnly(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function setTimeOnDate(dateObj, hhmmss) {
  const [h, m, s] = hhmmss.split(":").map(Number);
  const d = new Date(dateObj);
  d.setHours(h, m, s || 0, 0);
  return d;
}

export function minutesDiff(a, b) {
  return Math.floor((b.getTime() - a.getTime()) / 60000);
}

export function clampMin(n) {
  return n < 0 ? 0 : n;
}

export function nowLocal() {
  // Node uses system tz; ensure you run with proper TZ env
  return new Date();
}
