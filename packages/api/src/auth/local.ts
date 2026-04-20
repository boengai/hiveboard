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

const LOCAL_IPS = new Set([
  '127.0.0.1',
  '::1',
  '::ffff:127.0.0.1',
])

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
  const lower = ip.toLowerCase()
  return LOCAL_IPS.has(lower) || isDockerNetwork(lower)
}

export function isLocalRequest(request: Request): boolean {
  const peerIp = getPeerIP(request)
  if (!peerIp) return false
  return isLocalOrDockerHost(peerIp)
}
