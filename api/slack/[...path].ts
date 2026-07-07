import { ExpressReceiver } from "@slack/bolt";
import { createSecureLoreApp } from "../../apps/slack/src/bolt-app.js";

const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET ?? "",
  endpoints: {
    events: "/api/slack/events",
    commands: "/api/slack/commands",
    actions: "/api/slack/actions"
  },
  processBeforeResponse: false
});

createSecureLoreApp({ receiver });

export default receiver.app;
