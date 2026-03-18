/**
 * Parse a repo:* label value into owner and name.
 *
 * Supports two formats:
 *   - "repo:frontend"        → { owner: fallbackOwner, name: "frontend" }
 *   - "repo:other-org/backend" → { owner: "other-org", name: "backend" }
 */
export function parseRepoLabel(
  labels: string[],
  prefix: string,
  fallbackOwner: string,
): { repoOwner: string; repoName: string } | null {
  const match = labels.find((l) => l.startsWith(prefix));
  if (!match) return null;

  const value = match.slice(prefix.length);
  if (!value) return null;

  if (value.includes("/")) {
    const [owner, ...rest] = value.split("/");
    const name = rest.join("/"); // handles edge case of extra slashes
    if (!owner || !name) return null;
    return { repoOwner: owner, repoName: name };
  }

  return { repoOwner: fallbackOwner, repoName: value };
}
