/**
 * Associate a trusted peer IP with a Request.
 *
 * Bun's HTTP server exposes the actual socket peer address via
 * `server.requestIP(request)`. That value cannot be spoofed by the client,
 * whereas `X-Forwarded-For` / `X-Real-IP` headers can. The top-level
 * `Bun.serve` fetch handler populates this map for every incoming request;
 * auth code reads it back to decide whether the request is local.
 *
 * A Request whose peer IP was never registered returns null — callers must
 * treat that as "unknown origin" and refuse any auto-auth privilege.
 */

const peerIPs = new WeakMap<Request, string>()

export function setPeerIP(request: Request, ip: string): void {
  peerIPs.set(request, ip)
}

export function getPeerIP(request: Request): string | null {
  return peerIPs.get(request) ?? null
}
