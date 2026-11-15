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
  const cloud = process.env.SHIFTFLOW_CLOUD === "1";
  try {
    config = cloud ? {
      appDatabaseUrl: process.env.SHIFTFLOW_APP_DATABASE_URL ?? "",
      authDatabaseUrl: process.env.SHIFTFLOW_AUTH_DATABASE_URL ?? "",
      authSecret: process.env.SHIFTFLOW_AUTH_SECRET ?? "",
      engineToken: process.env.SHIFTFLOW_ENGINE_TOKEN ?? "",
      origin: process.env.SHIFTFLOW_PUBLIC_ORIGIN ?? "",
    } : JSON.parse(
      readFileSync(path.join(dataDirectory(), "runtime.json"), "utf8"),
    );
  } catch {
    throw new Error(
      "Local services are not configured. Run npm run db:start and npm run db:setup.",
    );
  }
  for (const value of [config.appDatabaseUrl, config.authDatabaseUrl]) {
    const u = new URL(value);
    if (cloud) {
      if (u.protocol !== "postgresql:" || !u.hostname.endsWith(".neon.tech") || u.searchParams.get("sslmode") !== "verify-full")
        throw new Error("Hosted ShiftFlow requires a verified TLS Neon connection.");
      continue;
    }
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
