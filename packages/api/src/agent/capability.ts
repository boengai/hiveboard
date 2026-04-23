import { consola } from 'consola'

let supported = false
let detected = false

export function checkpointsSupported(): boolean {
  return detected && supported
}

/** Test-only override. */
export function _setCheckpointSupportForTest(value: boolean | undefined): void {
  if (value === undefined) {
    detected = false
    supported = false
  } else {
    detected = true
    supported = value
  }
}

type SpawnLike = (cmd: string[]) => {
  exited: Promise<number>
  stdout: ReadableStream | null
  stderr: ReadableStream | null
}

export async function detectCheckpointSupport(options?: {
  spawn?: SpawnLike
  command?: string
}): Promise<boolean> {
  const command = options?.command ?? 'claude'
  const spawn: SpawnLike =
    options?.spawn ?? ((cmd) => Bun.spawn(cmd, { stderr: 'pipe', stdout: 'pipe' }))
  try {
    const proc = spawn([command, '--help'])
    const stdout = proc.stdout
      ? await new Response(proc.stdout).text()
      : ''
    const stderr = proc.stderr
      ? await new Response(proc.stderr).text()
      : ''
    await proc.exited
    const help = `${stdout}\n${stderr}`
    supported = /stream-json/.test(help)
    detected = true
    if (!supported) {
      consola.warn(
        'Claude CLI does not advertise --output-format stream-json; ' +
          'agent checkpoints are disabled.',
      )
    } else {
      consola.info('Claude CLI supports stream-json; checkpoint capture enabled.')
    }
    return supported
  } catch (err) {
    supported = false
    detected = true
    consola.warn(`Claude CLI capability check failed: ${(err as Error).message}`)
    return false
  }
}
