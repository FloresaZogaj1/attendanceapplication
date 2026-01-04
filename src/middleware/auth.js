import jwt from "jsonwebtoken";

export function auth(requiredRole = null) {
  return (req, res, next) => {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: "No token" });

    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      req.user = payload; // {id, role, full_name}
      if (requiredRole && payload.role !== requiredRole) {
        return res.status(403).json({ error: "Forbidden" });
      }
      next();
    } catch {
      return res.status(401).json({ error: "Invalid token" });
    }
  };
}
