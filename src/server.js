import app from "./app.js";
import { startAutoRulesJob } from "./jobs/autoRules.job.js";
import { startNotifyJob } from "./jobs/notifyIncidents.job.js";

if (process.env.NODE_ENV !== "test") {
	startAutoRulesJob();
	startNotifyJob();

	const port = process.env.PORT || 5050;
	app.listen(port, () => console.log("API running on", port));
}

export default app;
