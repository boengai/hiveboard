import type { FSWatcher } from 'node:fs'
import { mkdirSync, watch } from 'node:fs'
import { consola } from 'consola'
import type { Config } from '../config/schema'
import { agentStateDir, readScratchpad } from './agent-state'

const DEBOUNCE_MS = 250

type Disposer = () => void

export function watchScratchpad(
  config: Config,
  taskId: string,
  onChange: (content: string) => void,
): Disposer {
  let dir: string
  try {
    dir = agentStateDir(config, taskId)
  } catch (err) {
    consola.warn(`watchScratchpad ${taskId}: ${(err as Error).message}`)
    return () => {}
  }

  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    /* directory may already exist; ignore */
  }

  let timer: ReturnType<typeof setTimeout> | null = null
  let watcher: FSWatcher | null = null
  let disposed = false

  const fire = async () => {
    if (disposed) return
    const content = await readScratchpad(config, taskId)
    if (disposed) return
    try {
      onChange(content)
    } catch (err) {
      consola.warn(
        `watchScratchpad ${taskId} onChange: ${(err as Error).message}`,
      )
    }
  }

  try {
    watcher = watch(dir, { persistent: false }, (_event, filename) => {
      if (filename !== 'scratchpad.md') return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        void fire()
      }, DEBOUNCE_MS)
    })
    watcher.on('error', (err) => {
      consola.warn(
        `watchScratchpad ${taskId} watcher error: ${(err as Error).message}`,
      )
    })
  } catch (err) {
    consola.warn(`watchScratchpad ${taskId}: ${(err as Error).message}`)
  }

  // Initial fire with current contents
  void fire()

  return () => {
    disposed = true
    if (timer) clearTimeout(timer)
    watcher?.close()
  }
}
