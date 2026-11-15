import { readFileSync } from "node:fs";
import path from "node:path";
export interface RuntimeConfig {
  appDatabaseUrl: string;
  authDatabaseUrl: string;
  authSecret: string;
  engineToken: string;
  origin: string;
}
export const dataDirectory = () =>
  path.resolve(process.env.SHIFTFLOW_DATA_DIR || ".data");
let cached: RuntimeConfig | undefined;
export function runtimeConfig(): RuntimeConfig {
  if (cached) return cached;
  let config: RuntimeConfig;
  try {
    config = JSON.parse(
      readFileSync(path.join(dataDirectory(), "runtime.json"), "utf8"),
    );
  } catch {
    throw new Error(
      "Local services are not configured. Run npm run db:start and npm run db:setup.",
    );
  }
  for (const value of [config.appDatabaseUrl, config.authDatabaseUrl]) {
    const u = new URL(value);
    if (
      !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname) ||
      u.protocol !== "postgresql:"
    )
      throw new Error("Only loopback PostgreSQL connections are allowed.");
  }
  const pub = process.env.SHIFTFLOW_PUBLIC_ORIGIN;
  if (pub) {
    const u = new URL(pub);
    if (u.protocol !== "https:")
      throw new Error("SHIFTFLOW_PUBLIC_ORIGIN must be an https:// address.");
    config.origin = u.origin;
  } else {
    config.origin = process.env.SHIFTFLOW_ORIGIN || config.origin;
    const origin = new URL(config.origin);
    if (
      !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname) ||
      origin.protocol !== "http:"
    )
      throw new Error("ShiftFlow is configured for local HTTP only.");
  }
  if (config.authSecret.length < 32 || config.engineToken.length < 32)
    throw new Error("Missing local service secrets.");
  return (cached = config);
}
