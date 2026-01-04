import { Router } from "express";
import { auth } from "../middleware/auth.js";
import {
  employeeCheckin,
  employeeCheckout,
  startLunch,
  endLunch,
  startMiniBreak,
  endMiniBreak,
  getEmployeeDaySummary
} from "../services/rules.service.js";

const r = Router();

r.get("/me/day", auth(), async (req, res) => {
  const date = req.query.date; // YYYY-MM-DD
  const summary = await getEmployeeDaySummary(req.user.id, date);
  res.json(summary);
});

r.post("/checkin", auth(), async (req, res) => {
  const result = await employeeCheckin({ userId: req.user.id, at: new Date(), status: "normal" });
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

r.post("/checkout", auth(), async (req, res) => {
  const { manualCheckinTime } = req.body || {};
  const result = await employeeCheckout({
    userId: req.user.id,
    at: new Date(),
    status: "normal",
    manualCheckinTime
  });
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

r.post("/lunch/start", auth(), async (req, res) => {
  const result = await startLunch({ userId: req.user.id, at: new Date(), status: "normal" });
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

r.post("/lunch/end", auth(), async (req, res) => {
  const result = await endLunch({ userId: req.user.id, at: new Date(), status: "normal" });
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

r.post("/mini/start", auth(), async (req, res) => {
  const result = await startMiniBreak({ userId: req.user.id, at: new Date(), status: "normal" });
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

r.post("/mini/end", auth(), async (req, res) => {
  const result = await endMiniBreak({ userId: req.user.id, at: new Date(), status: "normal" });
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

export default r;
