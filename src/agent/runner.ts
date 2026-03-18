import { consola } from "consola";
import type { Config } from "../config/schema.ts";
import type { FormattedReviewComment } from "../github/types.ts";
import { sshSpawn } from "../ssh/client.ts";
import type { AgentResult, Issue } from "../types/issue.ts";
import { CONTINUATION_PROMPT, renderPrompt } from "./prompt.ts";

export interface RunAgentOptions {
  issue: Issue;
  workspacePath: string;
  promptTemplate: string;
  config: Config;
  workerHost?: string | null;
  retryAttempt?: number;
  reviewComments?: FormattedReviewComment[];
  signal?: AbortSignal;
}

/** Build Claude CLI arguments from config. */
function buildClaudeArgs(config: Config, prompt: string): string[] {
  const args: string[] = [
    config.claude.command,
    "--print",
    "--output-format",
    "json",
  ];

  if (config.claude.model) {
    args.push("--model", config.claude.model);
  }

  args.push("--max-turns", String(config.claude.max_turns));

  if (config.claude.allowed_tools?.length) {
    args.push("--allowedTools", config.claude.allowed_tools.join(","));
  }

  if (config.claude.permission_mode) {
    args.push("--permission-mode", config.claude.permission_mode);
  }

  args.push(prompt);

  return args;
}

/** Run Claude CLI for an issue. */
export async function runAgent(options: RunAgentOptions): Promise<AgentResult> {
  const {
    issue,
    workspacePath,
    promptTemplate,
    config,
    workerHost,
    retryAttempt,
    reviewComments,
    signal,
  } = options;

  const prompt = renderPrompt(
    promptTemplate,
    issue,
    retryAttempt && retryAttempt > 0 ? retryAttempt : undefined,
    reviewComments,
  );

  const args = buildClaudeArgs(config, prompt);

  consola.info(
    `Starting Claude CLI for issue #${issue.number}${workerHost ? ` on ${workerHost}` : ""}`,
  );

  let proc: ReturnType<typeof Bun.spawn>;

  if (workerHost) {
    // Run via SSH
    const escapedPath = workspacePath.replace(/'/g, "'\"'\"'");
    const command = `cd '${escapedPath}' && ${args.map((a) => `'${a.replace(/'/g, "'\"'\"'")}'`).join(" ")}`;
    proc = sshSpawn(workerHost, command);
  } else {
    // Run locally
    proc = Bun.spawn(args, {
      cwd: workspacePath,
      env: {
        ...process.env,
        HIVEBOARD_ISSUE_ID: issue.id,
        HIVEBOARD_ISSUE_NUMBER: String(issue.number),
        HIVEBOARD_WORKSPACE: workspacePath,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
  }

  // Handle abort signal
  if (signal) {
    signal.addEventListener("abort", () => {
      consola.warn(`Aborting Claude CLI for issue #${issue.number}`);
      proc.kill();
    });
  }

  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout as ReadableStream).text();
  const stderr = await new Response(proc.stderr as ReadableStream).text();

  if (exitCode !== 0) {
    consola.error(
      `Claude CLI failed for issue #${issue.number} (exit ${exitCode}): ${stderr.slice(0, 200)}`,
    );
    return {
      issueId: issue.id,
      success: false,
      output: stdout,
      error: stderr || `Exit code ${exitCode}`,
    };
  }

  consola.info(`Claude CLI completed for issue #${issue.number}`);
  return {
    issueId: issue.id,
    success: true,
    output: stdout,
  };
}

/** Run continuation turn (for retries). */
export async function runContinuation(
  options: Omit<RunAgentOptions, "promptTemplate">,
): Promise<AgentResult> {
  return runAgent({ ...options, promptTemplate: CONTINUATION_PROMPT });
}
