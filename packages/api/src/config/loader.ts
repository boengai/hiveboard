import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { consola } from 'consola'
import { parse as parseYaml } from 'yaml'
import { type Config, ConfigSchema } from './schema'

export type LoadedWorkflow = {
  config: Config
  promptTemplate: string
}

/**
 * Split WORKFLOW.md content into YAML front matter and prompt body.
 * Front matter is delimited by `---` on its own line.
 */
function splitFrontMatter(content: string): { yaml: string; body: string } {
  const lines = content.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') {
    throw new Error('WORKFLOW.md must start with --- (YAML front matter)')
  }

  const closingIdx = lines.indexOf('---', 1)
  if (closingIdx === -1) {
    throw new Error('WORKFLOW.md missing closing --- for front matter')
  }

  const yaml = lines.slice(1, closingIdx).join('\n')
  const body = lines.slice(closingIdx + 1).join('\n')
  return { body, yaml }
}

/**
 * Resolve the default WORKFLOW.md path independently of cwd. Two layouts
 * to support:
 *   - Source (dev): import.meta.dir = packages/api/src/config/
 *     → ../../WORKFLOW.md = packages/api/WORKFLOW.md
 *   - Bundled (Docker): import.meta.dir = packages/api/dist/
 *     → ../WORKFLOW.md   = packages/api/WORKFLOW.md
 * The WORKFLOW_PATH env var, if set, wins over both.
 */
function resolveDefaultWorkflowPath(): string {
  if (process.env.WORKFLOW_PATH) return process.env.WORKFLOW_PATH
  const candidates = [
    resolve(import.meta.dir, '../../WORKFLOW.md'),
    resolve(import.meta.dir, '../WORKFLOW.md'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  // Fall through to the source-layout candidate so the error message is
  // still meaningful when the file genuinely is missing.
  return candidates[0] ?? 'WORKFLOW.md'
}

/** Load and validate a WORKFLOW.md file. */
export async function loadWorkflow(
  path = resolveDefaultWorkflowPath(),
): Promise<LoadedWorkflow> {
  const file = Bun.file(path)
  const exists = await file.exists()
  if (!exists) {
    throw new Error(`WORKFLOW.md not found at: ${path}`)
  }

  const content = await file.text()
  const { yaml, body } = splitFrontMatter(content)

  const raw = parseYaml(yaml)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('WORKFLOW.md front matter must be a YAML mapping')
  }

  const result = ConfigSchema.safeParse(raw)
  if (!result.success) {
    const formatted = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    throw new Error(`Invalid WORKFLOW.md config:\n${formatted}`)
  }

  consola.info('Loaded WORKFLOW.md config')
  return { config: result.data, promptTemplate: body }
}
