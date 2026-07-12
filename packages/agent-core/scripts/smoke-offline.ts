import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { reviewArtifacts } from "@securelore/review-core";
import { enrichReviewPacket } from "../src/index.js";

const currentDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(currentDir, "../../../..");
const manifest = JSON.parse(
  await readFile(join(repoRoot, "artifacts/samples/bad-support-agent.manifest.json"), "utf8")
);
const reviewContext = JSON.parse(
  await readFile(join(repoRoot, "artifacts/samples/bad-support-agent.context.json"), "utf8")
);
const packet = reviewArtifacts({ manifest, reviewContext });
const enriched = await enrichReviewPacket(packet);

console.log(JSON.stringify({
  grade: enriched.overallRisk.grade,
  checks: enriched.evalTrace?.checks?.map((check) => check.name)
}, null, 2));
