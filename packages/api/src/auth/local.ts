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

/**
 * Docker internal hostnames that should be treated as local/trusted.
 * When Docker services communicate via service names (e.g. http://hiveboard:9080),
 * the Host header contains the container name rather than an IP address.
 * Configurable via DOCKER_INTERNAL_HOSTNAMES env var (comma-separated).
 */
function getDockerInternalHostnames(): Set<string> {
  const envHostnames = process.env.DOCKER_INTERNAL_HOSTNAMES
  const hostnames = new Set<string>(['hiveboard'])
  if (envHostnames) {
    for (const h of envHostnames.split(',')) {
      const trimmed = h.trim().toLowerCase()
      if (trimmed) hostnames.add(trimmed)
    }
  }
  return hostnames
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

function isLocalOrDockerHost(value: string): boolean {
  const lower = value.toLowerCase()
  return (
    LOCAL_IPS.has(lower) ||
    isDockerNetwork(lower) ||
    getDockerInternalHostnames().has(lower)
  )
}

export function isLocalRequest(request: Request): boolean {
  // Check for x-forwarded-for first — if present, trust the first entry
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const ip = forwarded.split(',')[0]?.trim() ?? ''
    return isLocalOrDockerHost(ip)
  }

  const realIp = request.headers.get('x-real-ip')
  if (realIp) {
    return isLocalOrDockerHost(realIp)
  }

  // Bun provides the remote address via the server's requestIP
  // but we can't access that here — fall back to checking URL
  const url = new URL(request.url)
  const host = url.hostname
  return isLocalOrDockerHost(host)
}
