import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { reviewArtifacts } from "../src/index.js";
import type { McpToolsListLike, SlackManifestLike } from "../src/index.js";

const currentDir = fileURLToPath(new URL(".", import.meta.url));
const root = join(currentDir, "../../../..");

const [manifestRaw, toolsRaw] = await Promise.all([
  readFile(join(root, "artifacts/samples/bad-support-agent.manifest.json"), "utf8"),
  readFile(join(root, "artifacts/samples/bad-mcp-tools.json"), "utf8")
]);

const manifest = JSON.parse(manifestRaw) as SlackManifestLike;
const mcpTools = JSON.parse(toolsRaw) as McpToolsListLike;

const packet = reviewArtifacts({
  manifest,
  mcpTools,
  fixtureIds: ["sg-001-broad-history-scopes", "sg-004-mcp-vague-write-tool"]
});

console.log(JSON.stringify(packet, null, 2));
