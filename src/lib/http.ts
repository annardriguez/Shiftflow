const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
export function localOnly(request: Request) {
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
