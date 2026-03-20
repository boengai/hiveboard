import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { consola } from 'consola'
import Mustache from 'mustache'
import type { Config } from '../config/schema'
import { validateWorkspacePath } from './path-safety'

export interface TaskForWorkspace {
  id: string
  title: string
  targetRepo: string | null
}

export interface WorkspaceResult {
  path: string
  created: boolean
}

/** Expand ~ to home directory. */
function expandTilde(p: string): string {
  if (p.startsWith('~/')) {
    const home = process.env.HOME ?? '/root'
    return resolve(home, p.slice(2))
  }
  return p
}

/**
 * Slugify a task title for use in branch names.
 * Lowercase, replace non-alphanumeric with `-`, trim dashes, max 50 chars.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
}

export class WorkspaceManager {
  private root: string
  private hooks: Config['hooks']
  readonly ttlMs: number

  constructor(config: Config) {
    this.root = expandTilde(config.workspace.root)
    this.hooks = config.hooks
    this.ttlMs = config.workspace.ttl_ms
  }

  /** Build workspace path for a task, scoped by repo to avoid collisions. */
  pathForTask(task: TaskForWorkspace): string {
    const repo = task.targetRepo?.split('/').pop() ?? 'unknown'
    return resolve(this.root, repo, `task-${task.id}`)
  }

  /** Build branch name for a task. */
  branchForTask(task: TaskForWorkspace): string {
    const slug = slugify(task.title)
    return `task-${task.id}/${slug}`
  }

  /** Create a workspace for a task (local only). */
  async createForTask(task: TaskForWorkspace, accessToken?: string): Promise<WorkspaceResult> {
    const wsPath = this.pathForTask(task)
    return this.createLocal(wsPath, task, accessToken)
  }

  private async createLocal(
    wsPath: string,
    task: TaskForWorkspace,
    accessToken?: string
  ): Promise<WorkspaceResult> {
    await validateWorkspacePath(wsPath, this.root)

    let created = false
    try {
      const info = await stat(wsPath)
      if (!info.isDirectory()) {
        await rm(wsPath, { force: true })
        await mkdir(wsPath, { recursive: true })
        created = true
      }
    } catch {
      await mkdir(wsPath, { recursive: true })
      created = true
    }

    if (created) {
      await this.runHook('after_create', wsPath, task, accessToken)
    }

    consola.info(`Workspace ready: ${wsPath} (created=${created})`)
    return { path: wsPath, created }
  }

  /** Remove a workspace for a task. */
  async removeForTask(task: TaskForWorkspace): Promise<void> {
    const wsPath = this.pathForTask(task)
    await this.runHook('before_remove', wsPath, task)
    await rm(wsPath, { recursive: true, force: true })
    consola.info(`Workspace removed: ${wsPath}`)
  }

  // -------------------------------------------------------------------------
  // TTL sweep
  // -------------------------------------------------------------------------

  /**
   * Remove local workspaces whose mtime is older than `ttlMs`.
   * Walks `root/{repo}/task-*` directories.
   */
  async sweepExpired(): Promise<number> {
    if (this.ttlMs <= 0) return 0

    const cutoff = Date.now() - this.ttlMs
    let removed = 0

    let repoDirs: string[]
    try {
      repoDirs = await readdir(this.root)
    } catch {
      return 0 // root doesn't exist yet
    }

    for (const repo of repoDirs) {
      const repoPath = join(this.root, repo)
      const repoStat = await stat(repoPath).catch(() => null)
      if (!repoStat?.isDirectory()) continue

      const entries = await readdir(repoPath)
      for (const entry of entries) {
        if (!entry.startsWith('task-')) continue

        const wsPath = join(repoPath, entry)
        const wsStat = await stat(wsPath).catch(() => null)
        if (!wsStat?.isDirectory()) continue

        if (wsStat.mtimeMs < cutoff) {
          consola.info(`Sweeping expired workspace: ${wsPath}`)
          await rm(wsPath, { recursive: true, force: true })
          removed++
        }
      }

      // Remove empty repo directory
      const remaining = await readdir(repoPath)
      if (remaining.length === 0) {
        await rm(repoPath, { recursive: true, force: true })
      }
    }

    if (removed > 0) {
      consola.info(`Swept ${removed} expired workspace(s)`)
    }
    return removed
  }

  // -------------------------------------------------------------------------
  // Hook execution
  // -------------------------------------------------------------------------

  private hookEnv(
    wsPath: string,
    task: TaskForWorkspace,
    accessToken?: string
  ): Record<string, string> {
    const [repoOwner, repoName] = (task.targetRepo ?? '/').split('/')
    const env: Record<string, string> = {
      HIVEBOARD_TASK_ID: task.id,
      HIVEBOARD_TASK_TITLE: task.title,
      HIVEBOARD_WORKSPACE: wsPath,
      HIVEBOARD_REPO_OWNER: repoOwner ?? '',
      HIVEBOARD_REPO_NAME: repoName ?? '',
    }
    if (accessToken) {
      env.GITHUB_TOKEN = accessToken
    }
    return env
  }

  async runHook(
    name: keyof Config['hooks'],
    wsPath: string,
    task: TaskForWorkspace,
    accessToken?: string
  ): Promise<void> {
    if (name === 'timeout_ms') return
    const rawScript = this.hooks[name]
    if (!rawScript) return

    const [repoOwner, repoName] = (task.targetRepo ?? '/').split('/')

    const script = Mustache.render(rawScript, {
      task: {
        id: task.id,
        title: task.title,
        repo_owner: repoOwner ?? '',
        repo_name: repoName ?? '',
      },
    }).trim()

    consola.debug(`Running hook ${name} in ${wsPath}: ${script}`)

    const proc = Bun.spawn(['sh', '-lc', script], {
      cwd: wsPath,
      env: { ...process.env, ...this.hookEnv(wsPath, task, accessToken) },
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const timeout = this.hooks.timeout_ms
    const result = await Promise.race([
      proc.exited,
      new Promise<'timeout'>((res) => setTimeout(() => res('timeout'), timeout)),
    ])

    if (result === 'timeout') {
      proc.kill()
      throw new Error(`Hook ${name} timed out after ${timeout}ms`)
    }

    if (result !== 0) {
      const stderr = await new Response(proc.stderr).text()
      throw new Error(`Hook ${name} failed (exit ${result}): ${stderr}`)
    }
  }
}
