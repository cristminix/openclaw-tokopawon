import dotenv from "dotenv";
import * as fs from "node:fs";
import * as path from "node:path";

export interface Config {
  wsUrl: string;
  token: string;
}

function findEnvFile(): string {
  const candidate = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(candidate)) return candidate;
  return candidate;
}

export function loadConfig(): Config {
  const envFile = findEnvFile();
  if (fs.existsSync(envFile)) {
    dotenv.config({ path: envFile });
  }

  const wsUrl = process.env.OPENCLAW_WS_URL || "";
  const token = process.env.OPENCLAW_TOKEN || "";

  if (!wsUrl) {
    throw new Error(
      "OPENCLAW_WS_URL is required. Copy .env.example to .env and configure."
    );
  }
  if (!token) {
    throw new Error(
      "OPENCLAW_TOKEN is required. Copy .env.example to .env and configure."
    );
  }

  return { wsUrl, token };
}
