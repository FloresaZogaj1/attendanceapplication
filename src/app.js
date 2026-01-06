import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

import authRoutes from "./routes/auth.routes.js";
import employeeRoutes from "./routes/employee.routes.js";
import adminRoutes from "./routes/admin.routes.js";

const app = express();

// CORS: temporarily allow all origins during network setup/testing
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

app.get("/health", (_, res) => res.json({ ok: true }));
// Also serve health check under /api prefix to simplify proxy/testing
app.get("/api/health", (_, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api/employee", employeeRoutes);
app.use("/api/admin", adminRoutes);

export default app;