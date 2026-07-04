import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import { requireEnv } from "../src/index.js";

const currentDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(currentDir, "../../../..");
const schema = await readFile(join(repoRoot, "db/schema.sql"), "utf8");
const sql = neon(requireEnv("DATABASE_URL"));

await sql.query(schema);
console.log("Applied SecureLore Neon schema.");
