import { getPeerIP } from './peer-ip'

/**
 * Detect whether a request originates from a local/trusted source.
 * Local requests are auto-authenticated as the queen-bee super-admin.
 *
 * Trust is based exclusively on the actual socket peer address, populated
 * at the `Bun.serve` layer via `server.requestIP(request)`. Client-supplied
 * headers (`X-Forwarded-For`, `X-Real-IP`, `Host`) are NEVER trusted —
 * otherwise any remote attacker could spoof localhost and gain super-admin.
 *
 * Trusted sources:
 * - localhost (127.0.0.1, ::1, ::ffff:127.0.0.1)
 * - Docker default bridge network (172.16.0.0/12)
 * - Docker compose network (typically 192.168.0.0/16, 10.0.0.0/8)
 */

const LOCAL_IPS = new Set(['127.0.0.1', '::1'])

/**
 * Strip the IPv4-mapped IPv6 prefix (`::ffff:`) so `::ffff:172.17.0.1` and
 * `172.17.0.1` compare the same. Bun's socket peer address is often returned
 * in the mapped form when the container listens on a dual-stack socket — the
 * Docker-port-mapping case where the connection lands on the bridge gateway.
 */
function normalizeIp(ip: string): string {
  const lower = ip.toLowerCase()
  if (lower.startsWith('::ffff:')) return lower.slice(7)
  return lower
}

function isDockerNetwork(ip: string): boolean {
  // 172.16.0.0 - 172.31.255.255 (172.16.0.0/12)
  if (ip.startsWith('172.')) {
    const second = Number.parseInt(ip.split('.')[1] ?? '0', 10)
    if (second >= 16 && second <= 31) return true
  }
  // 192.168.0.0/16
  if (ip.startsWith('192.168.')) return true
  // 10.0.0.0/8
  if (ip.startsWith('10.')) return true
  return false
}

function isLocalOrDockerHost(ip: string): boolean {
  const normalized = normalizeIp(ip)
  return LOCAL_IPS.has(normalized) || isDockerNetwork(normalized)
}

export function isLocalRequest(request: Request): boolean {
  const peerIp = getPeerIP(request)
  if (!peerIp) return false
  return isLocalOrDockerHost(peerIp)
}
