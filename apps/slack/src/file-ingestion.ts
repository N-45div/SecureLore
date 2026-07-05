import { classifyJsonArtifact } from "./input.js";
import type { ClassifiedJsonArtifact } from "./input.js";

export interface SlackFileInfo {
  id: string;
  name?: string;
  mimetype?: string;
  url_private_download?: string;
  url_private?: string;
}

export function validateJsonFile(file: SlackFileInfo): void {
  const name = file.name ?? "";
  const mimetype = file.mimetype ?? "";
  const looksJson =
    name.toLowerCase().endsWith(".json") ||
    mimetype === "application/json" ||
    mimetype === "text/plain";

  if (!looksJson) {
    throw new Error("Upload a .json Slack manifest or MCP tools/list file.");
  }

  if (!file.url_private_download && !file.url_private) {
    throw new Error("Slack did not provide a private download URL for this file.");
  }
}

export async function downloadSlackFileJson(file: SlackFileInfo, botToken: string): Promise<string> {
  validateJsonFile(file);
  const url = file.url_private_download ?? file.url_private;
  if (!url) {
    throw new Error("Slack file URL is missing.");
  }

  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${botToken}`
    }
  });

  if (!response.ok) {
    throw new Error(`Slack file download failed with ${response.status}.`);
  }

  return response.text();
}

export function classifySlackFileJson(rawJson: string): ClassifiedJsonArtifact {
  return classifyJsonArtifact(rawJson);
}
