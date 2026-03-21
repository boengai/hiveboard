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

/** Load and validate a WORKFLOW.md file. */
export async function loadWorkflow(
  path = 'WORKFLOW.md',
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
