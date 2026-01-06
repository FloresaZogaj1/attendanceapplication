import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

import authRoutes from "./routes/auth.routes.js";
import employeeRoutes from "./routes/employee.routes.js";
import adminRoutes from "./routes/admin.routes.js";

const app = express();

// CORS: allow production domain and localhost for development
const allowedOrigins = [
	"http://localhost:5173",
	"http://localhost:5050", // backend local health/testing
	"https://puna.illyrian.marketing",
];

app.use(
	cors({
		origin: function (origin, callback) {
			// Allow server-to-server or non-origin requests
			if (!origin) return callback(null, true);
			if (allowedOrigins.includes(origin)) return callback(null, true);
			// Also allow subdomain variations if needed in future
			return callback(new Error("Not allowed by CORS"));
		},
		credentials: true,
	})
);
app.use(express.json());

app.get("/health", (_, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api/employee", employeeRoutes);
app.use("/api/admin", adminRoutes);

export default app;