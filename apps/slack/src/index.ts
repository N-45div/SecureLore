import { createSecureLoreApp } from "./bolt-app.js";

const app = createSecureLoreApp();

await app.start(Number(process.env.PORT ?? 3000));
console.log("SecureLore Slack app is running.");
