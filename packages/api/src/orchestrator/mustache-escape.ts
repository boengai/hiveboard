/**
 * Escape Mustache delimiters and HTML-ish characters in agent-provided
 * strings so they cannot inject template logic or break rendering.
 * Extracted from orchestrator.ts to avoid a circular import with verify.ts.
 */
export function escapeMustacheSyntax(text: string): string {
  return text
    .replace(/\{(?=\{)/g, '{ ')
    .replace(/\}(?=\})/g, '} ')
    .replace(/\$(?=\{)/g, '$ ')
}
