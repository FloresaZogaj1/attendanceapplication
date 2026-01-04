import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import mysql from "mysql2/promise";
import fs from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcrypt";
import dotenv from "dotenv";
import { employeeCheckin, employeeCheckout } from "../src/services/rules.service.js";

dotenv.config();

process.env.NODE_ENV = "test";
if (!process.env.DB_NAME) {
  process.env.DB_NAME = "worktrack_test";
}

const dbName = process.env.DB_NAME;
const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASS || "",
  port: Number(process.env.DB_PORT || 3306)
};

let app;
let pool;
let adminToken;
let seededEmployeeId;
let flexEmployeeId;

async function runSqlFile(poolConn, filePath, replacementDb) {
  const sqlRaw = await fs.readFile(filePath, "utf8");
  const replaced = replacementDb ? sqlRaw.replace(/worktrack/g, replacementDb) : sqlRaw;
  await poolConn.query(replaced);
}

before(async () => {
  const setupPool = mysql.createPool({ ...dbConfig, waitForConnections: true, connectionLimit: 2, multipleStatements: true });

  await setupPool.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
  await setupPool.query(`CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

  const schemaPath = path.resolve("../db/001_schema.sql");
  await runSqlFile(setupPool, schemaPath, dbName);

  await setupPool.query(`USE \`${dbName}\``);

  const adminPassword = await bcrypt.hash("688967", 10);
  await setupPool.query(
    "INSERT INTO users(full_name,email,password_hash,role,is_active) VALUES(?,?,?,?,1)",
    ["Admin User", "admin@example.com", adminPassword, "ADMIN"]
  );

  const employees = [
    ["Sarah Miller", "sarah@example.com", "EMPLOYEE"],
    ["John Smith", "john@example.com", "EMPLOYEE"]
  ];

  for (const [fullName, email, role] of employees) {
    const [result] = await setupPool.query(
      "INSERT INTO users(full_name,email,password_hash,role,is_active) VALUES(?,?,?,?,1)",
      [fullName, email, adminPassword, role]
    );
    if (!seededEmployeeId) seededEmployeeId = result.insertId;
  }

  const flexEmployees = [
    ["Berat Rakovica", "berat@example.com"],
    ["Shkelqim Ibishi", "shkelqim@example.com"]
  ];

  for (const [fullName, email] of flexEmployees) {
    const [insert] = await setupPool.query(
      "INSERT INTO users(full_name,email,password_hash,role,is_active,flex_mode) VALUES(?,?,?,?,1,1)",
      [fullName, email, adminPassword, "EMPLOYEE"]
    );
    if (!flexEmployeeId) flexEmployeeId = insert.insertId;
  }

  const workdayInsert = await setupPool.query(
    `INSERT INTO workday(user_id, day_date, checkin_at, checkout_at, lunch_start, lunch_end, lunch_status, break_total_minutes, compensation_minutes, compensation_work_minutes)
     VALUES(?, '2026-01-03', '2026-01-03 08:55:00', '2026-01-03 17:05:00', '2026-01-03 12:10:00', '2026-01-03 12:55:00', 'normal', 65, 15, 45)` ,
    [seededEmployeeId]
  );

  const workdayId = workdayInsert[0].insertId;

  await setupPool.query(
    `INSERT INTO attendance_event(user_id, workday_id, event_type, event_at, status, meta)
     VALUES
     (?, ?, 'checkin', '2026-01-03 08:55:00', 'manual', '{"lateMin":5}'),
     (?, ?, 'lunch_start', '2026-01-03 12:10:00', 'normal', NULL),
     (?, ?, 'lunch_end', '2026-01-03 12:55:00', 'normal', NULL),
     (?, ?, 'checkout', '2026-01-03 17:05:00', 'normal', NULL)` ,
    [seededEmployeeId, workdayId, seededEmployeeId, workdayId, seededEmployeeId, workdayId, seededEmployeeId, workdayId]
  );

  await setupPool.query(
    `INSERT INTO mini_break(user_id, workday_id, start_at, end_at, duration_minutes, exceeded_minutes, status)
     VALUES (?, ?, '2026-01-03 15:30:00', '2026-01-03 15:40:00', 10, 3, 'normal')`,
    [seededEmployeeId, workdayId]
  );

  await setupPool.query(
    `INSERT INTO incident(user_id, workday_id, code, message, severity, occurred_at, notify_after, channel)
     VALUES (?, ?, 'MINI_BREAK_EXCEED_7', 'Mini-break exceeded limit', 'warn', '2026-01-03 15:40:00', '2026-01-03 20:00:00', 'both')`,
    [seededEmployeeId, workdayId]
  );

  await setupPool.end();

  ({ default: app } = await import("../src/app.js"));
  ({ pool } = await import("../src/config/db.js"));
});

after(async () => {
  if (pool) {
    await pool.end();
  }

  const cleanupPool = mysql.createPool({ ...dbConfig, waitForConnections: true, connectionLimit: 2 });
  await cleanupPool.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
  await cleanupPool.end();
});

async function loginAdmin() {
  if (adminToken) return adminToken;
  const res = await request(app)
    .post("/api/auth/login")
    .send({ email: "admin@example.com", password: "688967" })
    .expect(200);
  adminToken = res.body.token;
  return adminToken;
}

test("admin can login", async () => {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ email: "admin@example.com", password: "688967" })
    .expect(200);

  assert.ok(res.body.token);
  assert.equal(res.body.user.role, "ADMIN");
});

test("list employees returns seeded users", async () => {
  const token = await loginAdmin();
  const res = await request(app)
    .get("/api/admin/employees")
    .set("Authorization", `Bearer ${token}`)
    .expect(200);

  assert.ok(Array.isArray(res.body.items));
  assert.ok(res.body.items.length >= 4);
  const names = res.body.items.map((e) => e.full_name).sort();
  for (const expected of ["John Smith", "Sarah Miller", "Berat Rakovica", "Shkelqim Ibishi"]) {
    assert.ok(names.includes(expected));
  }
  const beratEntry = res.body.items.find((e) => e.full_name === "Berat Rakovica");
  assert.strictEqual(beratEntry?.flex_mode, true);
});

test("create employee and fetch detail", async () => {
  const token = await loginAdmin();
  const res = await request(app)
    .post("/api/admin/employees")
    .set("Authorization", `Bearer ${token}`)
    .send({ full_name: "Linda Lee", email: "linda@example.com", password: "Secret123" })
    .expect(201);

  assert.ok(res.body.employee?.id);
  assert.equal(res.body.employee.full_name, "Linda Lee");

  const detail = await request(app)
    .get(`/api/admin/employees/${res.body.employee.id}`)
    .set("Authorization", `Bearer ${token}`)
    .expect(200);

  assert.equal(detail.body.employee.email, "linda@example.com");
});

test("day timeline returns events and summary", async () => {
  const token = await loginAdmin();
  const res = await request(app)
    .get(`/api/admin/employees/${seededEmployeeId}/timeline/day`)
    .query({ date: "2026-01-03" })
    .set("Authorization", `Bearer ${token}`)
    .expect(200);

  assert.equal(res.body.user.id, seededEmployeeId);
  assert.ok(Array.isArray(res.body.timeline));
  assert.equal(res.body.timeline.length, 4);
  assert.equal(res.body.summary.breakMinutes, 65);
  assert.equal(res.body.summary.miniBreakCount, 1);
});

test("aggregate timeline returns weekly totals", async () => {
  const token = await loginAdmin();
  const res = await request(app)
    .get(`/api/admin/employees/${seededEmployeeId}/timeline/aggregate`)
    .query({ range: "week", anchor: "2026-01-04" })
    .set("Authorization", `Bearer ${token}`)
    .expect(200);

  assert.equal(res.body.range, "week");
  assert.ok(res.body.days.length >= 1);
  const dayEntry = res.body.days.find((d) => d.day === "2026-01-03");
  assert.ok(dayEntry);
  assert.equal(dayEntry.incidents, 1);
});

test("incidents endpoint returns seeded incident", async () => {
  const token = await loginAdmin();
  const res = await request(app)
    .get(`/api/admin/employees/${seededEmployeeId}/incidents`)
    .set("Authorization", `Bearer ${token}`)
    .expect(200);

  assert.ok(Array.isArray(res.body.items));
  assert.equal(res.body.items.length, 1);
  assert.equal(res.body.items[0].code, "MINI_BREAK_EXCEED_7");
});

test("monthly report returns CSV", async () => {
  const token = await loginAdmin();
  const res = await request(app)
    .get(`/api/admin/employees/${seededEmployeeId}/report`)
    .query({ month: "2026-01" })
    .set("Authorization", `Bearer ${token}`)
    .expect(200);

  assert.ok(res.headers["content-type"].startsWith("text/csv"));
  assert.ok(res.text.includes("Date,Check-in"));
  assert.ok(res.text.includes("2026-01-03"));
});

test("flex employee bypasses attendance restrictions", async () => {
  const checkin1 = await employeeCheckin({
    userId: flexEmployeeId,
    at: new Date("2026-01-04T10:30:00"),
    status: "normal"
  });
  assert.equal(checkin1.ok, true);
  assert.equal(checkin1.lateMin, 0);

  const checkin2 = await employeeCheckin({
    userId: flexEmployeeId,
    at: new Date("2026-01-04T14:00:00"),
    status: "normal"
  });
  assert.equal(checkin2.ok, true);

  const checkout1 = await employeeCheckout({
    userId: flexEmployeeId,
    at: new Date("2026-01-04T18:30:00"),
    status: "normal"
  });
  assert.equal(checkout1.ok, true);

  const checkout2 = await employeeCheckout({
    userId: flexEmployeeId,
    at: new Date("2026-01-04T19:45:00"),
    status: "normal"
  });
  assert.equal(checkout2.ok, true);

  const [incidentCountRows] = await pool.query("SELECT COUNT(*) AS c FROM incident WHERE user_id=?", [flexEmployeeId]);
  assert.equal(Number(incidentCountRows[0].c), 0);
});