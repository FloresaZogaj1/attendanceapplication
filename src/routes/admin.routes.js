import { Router } from "express";
import { auth } from "../middleware/auth.js";
import { adminLiveOverview, getEmployeeDaySummary } from "../services/rules.service.js";
import {
  listEmployees,
  getEmployeeById,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  resetEmployeeSecret
} from "../services/admin.service.js";
import {
  getEmployeeDayTimeline,
  getEmployeeAggregate,
  getEmployeeIncidents,
  buildMonthlyReportCsv
} from "../services/timeline.service.js";

const r = Router();

r.get("/employees", auth("ADMIN"), async (req, res) => {
  try {
    const { search = "", page = "1", pageSize = "20", includeInactive = "false" } = req.query;
    const data = await listEmployees({
      search,
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 20,
      includeInactive: includeInactive === "true"
    });
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message || "Failed to list employees" });
  }
});

r.post("/employees", auth("ADMIN"), async (req, res) => {
  try {
    const employee = await createEmployee(req.body || {});
    res.status(201).json({ employee });
  } catch (err) {
    res.status(400).json({ error: err.message || "Failed to create employee" });
  }
});

r.get("/employees/:id", auth("ADMIN"), async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid employee id" });
  const employee = await getEmployeeById(id);
  if (!employee) return res.status(404).json({ error: "Employee not found" });
  res.json({ employee });
});

r.put("/employees/:id", auth("ADMIN"), async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid employee id" });
  try {
    const employee = await updateEmployee(id, req.body || {});
    res.json({ employee });
  } catch (err) {
    res.status(err.message === "Employee not found" ? 404 : 400).json({ error: err.message });
  }
});

r.delete("/employees/:id", auth("ADMIN"), async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid employee id" });
  try {
    const result = await deleteEmployee(id, { hard: req.query.hard === "true" });
    if (req.query.hard === "true") {
      res.status(204).end();
    } else {
      res.json(result);
    }
  } catch (err) {
    res.status(400).json({ error: err.message || "Failed to delete employee" });
  }
});

r.post("/employees/:id/reset-secret", auth("ADMIN"), async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid employee id" });
  try {
    const result = await resetEmployeeSecret(id, req.body || {});
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message || "Failed to reset secret" });
  }
});

r.get("/employees/:id/timeline/day", auth("ADMIN"), async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid employee id" });
  try {
    const data = await getEmployeeDayTimeline(id, req.query.date);
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message || "Failed to load timeline" });
  }
});

r.get("/employees/:id/timeline/aggregate", auth("ADMIN"), async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid employee id" });
  const { range = "week", anchor } = req.query;
  try {
    const data = await getEmployeeAggregate(id, { range, anchor });
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message || "Failed to load aggregate" });
  }
});

r.get("/employees/:id/incidents", auth("ADMIN"), async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid employee id" });
  try {
    const data = await getEmployeeIncidents(id, req.query || {});
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message || "Failed to load incidents" });
  }
});

r.get("/employees/:id/report", auth("ADMIN"), async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid employee id" });
  try {
    const { csv, month, user } = await buildMonthlyReportCsv(id, { month: req.query.month, format: req.query.format });
    const filename = `employee-${user.id}-${month}.csv`;
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=\"${filename}\"`);
    res.send(csv);
  } catch (err) {
    res.status(400).json({ error: err.message || "Failed to generate report" });
  }
});

r.get("/live", auth("ADMIN"), async (req, res) => {
  const date = req.query.date; // YYYY-MM-DD
  const groups = await adminLiveOverview(date);
  res.json(groups);
});

r.get("/employee/:id/day", auth("ADMIN"), async (req, res) => {
  const date = req.query.date;
  const userId = Number(req.params.id);
  const summary = await getEmployeeDaySummary(userId, date);
  res.json(summary);
});

export default r;
