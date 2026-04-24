const REGEX_META = /[.*+?^${}()|[\]\\]/g

export type SecretPair = { name: string; value: string }

/**
 * Single-pass literal-match scrubber. Replaces every occurrence of each value
 * in `pairs` with `[redacted:NAME]`. Longer values win ties (handled by sort).
 *
 * Intentionally literal-match only; no entropy / regex heuristics in v1.
 * Runs once across the output (one compiled RegExp) so cost is O(N + M*log M)
 * rather than O(N * M).
 */
export function scrubSecrets(output: string, pairs: SecretPair[]): string {
  if (!output || pairs.length === 0) return output
  const filtered = pairs.filter((p) => p.value.length > 0)
  if (filtered.length === 0) return output
  const sorted = [...filtered].sort((a, b) => b.value.length - a.value.length)
  const byValue = new Map<string, string>()
  for (const p of sorted) {
    byValue.set(p.value, p.name)
  }
  const pattern = sorted
    .map((p) => p.value.replace(REGEX_META, '\\$&'))
    .join('|')
  const re = new RegExp(pattern, 'g')
  return output.replace(re, (match) => {
    const name = byValue.get(match)
    return name ? `[redacted:${name}]` : match
  })
}
