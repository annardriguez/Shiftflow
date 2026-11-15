const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
/**
 * The public HTTPS origin when deployed behind a proxy (e.g. a hosted demo),
 * from SHIFTFLOW_PUBLIC_ORIGIN. Unset means the default loopback-only mode.
 */
export function publicOrigin() {
  const value = process.env.SHIFTFLOW_PUBLIC_ORIGIN;
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}
export function localOnly(request: Request) {
  const pub = publicOrigin();
  if (pub) {
    // Behind an HTTPS proxy the internal request URL is not meaningful.
    // Reads are allowed; writes must come from the public origin itself,
    // which browsers always state in the Origin header (CSRF protection).
    const origin = request.headers.get("origin");
    if (!origin) return request.method === "GET" || request.method === "HEAD";
    return origin === pub;
  }
  const url = new URL(request.url);
  if (!localHosts.has(url.hostname)) return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const source = new URL(origin);
    return (
      localHosts.has(source.hostname) &&
      source.host === request.headers.get("host") &&
      source.protocol === url.protocol
    );
  } catch {
    return false;
  }
}
