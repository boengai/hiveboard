/**
 * Detect whether a request originates from a local/trusted source.
 * Local requests are auto-authenticated as the queen-bee super-admin.
 *
 * Trusted sources:
 * - localhost (127.0.0.1, ::1, ::ffff:127.0.0.1)
 * - Docker default bridge network (172.16.0.0/12)
 * - Docker compose network (typically 192.168.0.0/16)
 * - 0.0.0.0 (binding address)
 */

const LOCAL_IPS = new Set([
  '127.0.0.1',
  '::1',
  '::ffff:127.0.0.1',
  '0.0.0.0',
  'localhost',
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

export function isLocalRequest(request: Request): boolean {
  // Check for x-forwarded-for first — if present, trust the first entry
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const ip = forwarded.split(',')[0]?.trim() ?? ''
    return LOCAL_IPS.has(ip) || isDockerNetwork(ip)
  }

  const realIp = request.headers.get('x-real-ip')
  if (realIp) {
    return LOCAL_IPS.has(realIp) || isDockerNetwork(realIp)
  }

  // Bun provides the remote address via the server's requestIP
  // but we can't access that here — fall back to checking URL
  const url = new URL(request.url)
  const host = url.hostname
  return LOCAL_IPS.has(host) || isDockerNetwork(host)
}
