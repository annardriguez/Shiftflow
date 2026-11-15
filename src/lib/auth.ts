import { betterAuth, type BetterAuthOptions } from "better-auth";
import { Pool } from "pg";
import { runtimeConfig } from "./runtime-config";
let instance: ReturnType<typeof betterAuth> | undefined;
export function authOptions(pool?: Pool): BetterAuthOptions {
  const c = runtimeConfig();
  return {
    appName: "ShiftFlow",
    baseURL: c.origin,
    secret: c.authSecret,
    database:
      pool ??
      new Pool({
        connectionString: c.authDatabaseUrl,
        max: 5,
        options: "-c search_path=auth,pg_catalog",
      }).on("error", () =>
        console.error("Local authentication database connection interrupted."),
      ),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
    },
    session: {
      expiresIn: 60 * 60 * 8,
      updateAge: 60 * 30,
      disableSessionRefresh: true,
      cookieCache: { enabled: false },
    },
    trustedOrigins: [c.origin],
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 200,
      customRules: {
        "/sign-in/email": {
          window: 60,
          max: Number(process.env.SHIFTFLOW_AUTH_ATTEMPTS || 12),
        },
      },
    },
    advanced: {
      cookiePrefix: "shiftflow",
      ipAddress: { ipAddressHeaders: ["x-shiftflow-client-ip"] },
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "strict",
        secure: false,
      },
    },
    telemetry: { enabled: false },
    logger: { level: "error" },
  };
}
export function getAuth() {
  return (instance ??= betterAuth(authOptions()));
}
