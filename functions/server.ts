// Express wrapper for Render deployment. Each handler already exports a
// default (req, res) function matching Express's signature (this is the
// same convention nhost Functions uses), so this just mounts them at the
// same paths nhost would have auto-routed to.
import express from "express";
import triggerWorkflowRun from "./trigger-workflow-run/index";
import approveStep from "./approve-step/index";
import webhookTrigger from "./webhook-trigger/index";
import onNotify from "./on-notify/index";
import onInboundCall from "./on-inbound-call/index";
import cronTick from "./cron-tick/index";

const app = express();
app.use(express.json());

app.get("/healthz", (_req, res) => res.status(200).send("OK"));

app.post("/trigger-workflow-run", triggerWorkflowRun);
app.post("/approve-step", approveStep);
app.post("/webhook-trigger", webhookTrigger);
app.post("/on-notify", onNotify);
app.post("/on-inbound-call", onInboundCall);
app.post("/cron-tick", cronTick);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Functions server listening on port ${port}`);
});
