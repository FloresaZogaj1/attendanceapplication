import { Router } from "express";
import { pool } from "../config/db.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const r = Router();

r.post("/login", async (req, res) => {
  const { email, password, pin } = req.body || {};
  const secret = typeof password === "string" && password.length ? password : pin;
  if (!email || !secret) return res.status(400).json({ error: "Missing credentials" });

  let rows;
  try {
    [rows] = await pool.query("SELECT * FROM users WHERE email=? LIMIT 1", [email]);
  } catch (err) {
    console.error("/login query failed", err);
    return res.status(500).json({ error: "Login failed" });
  }

  const u = rows?.[0];
  if (!u) return res.status(401).json({ error: "Invalid login" });

  if (typeof u.is_active !== "undefined" && Number(u.is_active) === 0) {
    return res.status(403).json({ error: "Account disabled" });
  }

  let ok = false;

  const passwordHash = u.password_hash || u.password || null;
  const pinValue = u.pin || u.pin_code || null;
  const pinHash = u.pin_hash || u.pinHash || null;
  const pinEnabled = typeof u.pin_enabled === "undefined" ? true : Boolean(u.pin_enabled);

  if (passwordHash) {
    try {
      ok = await bcrypt.compare(secret, passwordHash);
    } catch (err) {
      console.warn("bcrypt compare failed", err);
    }
  }

  if (!ok && pinHash && pinEnabled) {
    try {
      ok = await bcrypt.compare(secret, pinHash);
    } catch (err) {
      console.warn("bcrypt pin compare failed", err);
    }
  }

  if (!ok && pinValue != null && pinEnabled) {
    ok = secret === String(pinValue);
  }

  if (!ok && !passwordHash && !pinValue && u.password_plain) {
    ok = secret === String(u.password_plain);
  }

  if (!ok) return res.status(401).json({ error: "Invalid login" });

  const fullName = u.full_name || u.name || u.display_name || u.email;

  const token = jwt.sign(
    { id: u.id, role: u.role, full_name: fullName },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

  res.json({ token, user: { id: u.id, role: u.role, full_name: fullName, email: u.email } });
});

export default r;
