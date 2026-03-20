import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { consola } from "consola";
import Mustache from "mustache";
import type { Config } from "../config/schema.ts";
import { sshExec } from "../ssh/client.ts";
import type { Issue } from "../types.ts";
import { validateWorkspacePath } from "./path-safety.ts";

export interface WorkspaceResult {
  path: string;
  created: boolean;
}

/** Escape a string for use inside single-quoted shell argument. */
function shellEscape(s: string): string {
  return s.replace(/'/g, "'\"'\"'");
}

/** Expand ~ to home directory. */
function expandTilde(p: string): string {
  if (p.startsWith("~/")) {
    const home = process.env.HOME ?? "/root";
    return resolve(home, p.slice(2));
  }
  return p;
}

export class WorkspaceManager {
  private root: string;
  private hooks: Config["hooks"];
  readonly ttlMs: number;

  constructor(config: Config) {
    this.root = expandTilde(config.workspace.root);
    this.hooks = config.hooks;
    this.ttlMs = config.workspace.ttl_ms;
  }

  /** Build workspace path for an issue, scoped by repo to avoid collisions. */
  pathForIssue(issue: Issue): string {
    const repo = issue.repoName ?? "unknown";
    return resolve(this.root, repo, `issue-${issue.number}`);
  }

  /** Create a workspace for an issue (local or remote). */
  async createForIssue(
    issue: Issue,
    workerHost?: string | null,
    accessToken?: string,
  ): Promise<WorkspaceResult> {
    const wsPath = this.pathForIssue(issue);

    if (workerHost) {
      return this.createRemote(wsPath, issue, workerHost, accessToken);
    }

    return this.createLocal(wsPath, issue, accessToken);
  }

  private async createLocal(
    wsPath: string,
    issue: Issue,
    accessToken?: string,
  ): Promise<WorkspaceResult> {
    await validateWorkspacePath(wsPath, this.root);

    let created = false;
    try {
      const info = await stat(wsPath);
      if (!info.isDirectory()) {
        await rm(wsPath, { force: true });
        await mkdir(wsPath, { recursive: true });
        created = true;
      }
    } catch {
      await mkdir(wsPath, { recursive: true });
      created = true;
    }

    if (created) {
      await this.runHook("after_create", wsPath, issue, accessToken);
    }

    consola.info(`Workspace ready: ${wsPath} (created=${created})`);
    return { path: wsPath, created };
  }

  private async createRemote(
    wsPath: string,
    issue: Issue,
    host: string,
    accessToken?: string,
  ): Promise<WorkspaceResult> {
    const escapedPath = shellEscape(wsPath);
    const script = [
      `WS='${escapedPath}'`,
      // Expand tilde on remote
      `WS=$(eval echo "$WS")`,
      `if [ -d "$WS" ]; then echo "__HIVEBOARD_WORKSPACE__\t0\t$WS"; exit 0; fi`,
      `if [ -e "$WS" ]; then rm -f "$WS"; fi`,
      `mkdir -p "$WS"`,
      `echo "__HIVEBOARD_WORKSPACE__\t1\t$WS"`,
    ].join(" && ");

    const { stdout, exitCode } = await sshExec(host, script);

    if (exitCode !== 0) {
      throw new Error(`Remote workspace creation failed on ${host}: ${stdout}`);
    }

    const match = stdout.match(/__HIVEBOARD_WORKSPACE__\t(\d)\t(.+)/);
    if (!match) {
      throw new Error(
        `Unexpected remote workspace output from ${host}: ${stdout}`,
      );
    }

    const created = match[1] === "1";
    const remotePath = match[2] ?? "";

    if (created) {
      await this.runHookRemote(
        "after_create",
        remotePath,
        issue,
        host,
        accessToken,
      );
    }

    consola.info(
      `Remote workspace ready on ${host}: ${remotePath} (created=${created})`,
    );
    return { path: remotePath, created };
  }

  /** Remove a workspace. */
  async removeForIssue(
    issue: Issue,
    workerHost?: string | null,
  ): Promise<void> {
    const wsPath = this.pathForIssue(issue);

    if (workerHost) {
      await this.runHookRemote("before_remove", wsPath, issue, workerHost);
      const escapedPath = shellEscape(wsPath);
      await sshExec(workerHost, `rm -rf '${escapedPath}'`);
    } else {
      await this.runHook("before_remove", wsPath, issue);
      await rm(wsPath, { recursive: true, force: true });
    }

    consola.info(`Workspace removed: ${wsPath}`);
  }

  // -------------------------------------------------------------------------
  // TTL sweep
  // -------------------------------------------------------------------------

  /**
   * Remove local workspaces whose mtime is older than `ttlMs`.
   * Walks `root/{repo}/issue-*` directories.
   */
  async sweepExpired(): Promise<number> {
    if (this.ttlMs <= 0) return 0;

    const cutoff = Date.now() - this.ttlMs;
    let removed = 0;

    let repoDirs: string[];
    try {
      repoDirs = await readdir(this.root);
    } catch {
      return 0; // root doesn't exist yet
    }

    for (const repo of repoDirs) {
      const repoPath = join(this.root, repo);
      const repoStat = await stat(repoPath).catch(() => null);
      if (!repoStat?.isDirectory()) continue;

      const entries = await readdir(repoPath);
      for (const entry of entries) {
        if (!entry.startsWith("issue-")) continue;

        const wsPath = join(repoPath, entry);
        const wsStat = await stat(wsPath).catch(() => null);
        if (!wsStat?.isDirectory()) continue;

        if (wsStat.mtimeMs < cutoff) {
          consola.info(`Sweeping expired workspace: ${wsPath}`);
          await rm(wsPath, { recursive: true, force: true });
          removed++;
        }
      }

      // Remove empty repo directory
      const remaining = await readdir(repoPath);
      if (remaining.length === 0) {
        await rm(repoPath, { recursive: true, force: true });
      }
    }

    if (removed > 0) {
      consola.info(`Swept ${removed} expired workspace(s)`);
    }
    return removed;
  }

  // -------------------------------------------------------------------------
  // Hook execution
  // -------------------------------------------------------------------------

  private hookEnv(
    wsPath: string,
    issue: Issue,
    accessToken?: string,
  ): Record<string, string> {
    const env: Record<string, string> = {
      HIVEBOARD_ISSUE_ID: issue.id,
      HIVEBOARD_ISSUE_NUMBER: String(issue.number),
      HIVEBOARD_ISSUE_TITLE: issue.title,
      HIVEBOARD_WORKSPACE: wsPath,
      HIVEBOARD_REPO_OWNER: issue.repoOwner ?? "",
      HIVEBOARD_REPO_NAME: issue.repoName ?? "",
      HIVEBOARD_SOURCE_OWNER: issue.sourceOwner ?? "",
      HIVEBOARD_SOURCE_REPO: issue.sourceRepo ?? "",
    };
    if (accessToken) {
      env.GITHUB_TOKEN = accessToken;
    }
    return env;
  }

  async runHook(
    name: keyof Config["hooks"],
    wsPath: string,
    issue: Issue,
    accessToken?: string,
  ): Promise<void> {
    if (name === "timeout_ms") return;
    const rawScript = this.hooks[name];
    if (!rawScript) return;

    const script = Mustache.render(rawScript, {
      issue: {
        id: issue.id,
        number: issue.number,
        title: issue.title,
        action: issue.action ?? "",
        repo_owner: issue.repoOwner ?? "",
        repo_name: issue.repoName ?? "",
        source_owner: issue.sourceOwner ?? "",
        source_repo: issue.sourceRepo ?? "",
      },
    }).trim();

    consola.debug(`Running hook ${name} in ${wsPath}: ${script}`);

    const proc = Bun.spawn(["sh", "-lc", script], {
      cwd: wsPath,
      env: { ...process.env, ...this.hookEnv(wsPath, issue, accessToken) },
      stdout: "pipe",
      stderr: "pipe",
    });

    const timeout = this.hooks.timeout_ms;
    const result = await Promise.race([
      proc.exited,
      new Promise<"timeout">((res) =>
        setTimeout(() => res("timeout"), timeout),
      ),
    ]);

    if (result === "timeout") {
      proc.kill();
      throw new Error(`Hook ${name} timed out after ${timeout}ms`);
    }

    if (result !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`Hook ${name} failed (exit ${result}): ${stderr}`);
    }
  }

  private async runHookRemote(
    name: keyof Config["hooks"],
    wsPath: string,
    issue: Issue,
    host: string,
    accessToken?: string,
  ): Promise<void> {
    if (name === "timeout_ms") return;
    const rawScript = this.hooks[name];
    if (!rawScript) return;

    const script = Mustache.render(rawScript, {
      issue: {
        id: issue.id,
        number: issue.number,
        title: issue.title,
        action: issue.action ?? "",
        repo_owner: issue.repoOwner ?? "",
        repo_name: issue.repoName ?? "",
        source_owner: issue.sourceOwner ?? "",
        source_repo: issue.sourceRepo ?? "",
      },
    }).trim();

    const env = this.hookEnv(wsPath, issue, accessToken);
    const envExports = Object.entries(env)
      .map(([k, v]) => `export ${k}='${shellEscape(v)}'`)
      .join("; ");

    const escapedPath = shellEscape(wsPath);
    const fullScript = `${envExports}; cd '${escapedPath}' && ${script}`;

    const { exitCode, stdout } = await sshExec(host, fullScript, {
      timeoutMs: this.hooks.timeout_ms,
    });

    if (exitCode !== 0) {
      throw new Error(
        `Remote hook ${name} failed on ${host} (exit ${exitCode}): ${stdout}`,
      );
    }
  }
}
