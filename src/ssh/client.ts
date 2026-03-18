import { consola } from "consola";

export interface SshExecResult {
  stdout: string;
  exitCode: number;
}

export interface SshExecOptions {
  timeoutMs?: number;
}

/** Escape a string for single-quoted shell argument. */
function shellEscape(s: string): string {
  return s.replace(/'/g, "'\"'\"'");
}

/**
 * Parse host string into host and optional port.
 * Supports "host:port" and plain "host".
 */
function parseHost(hostStr: string): { host: string; port?: string } {
  // Avoid splitting IPv6 addresses that aren't bracketed
  const lastColon = hostStr.lastIndexOf(":");
  if (lastColon === -1) return { host: hostStr };

  // Simple heuristic: if there's more than one colon, it's probably IPv6
  const colonCount = (hostStr.match(/:/g) || []).length;
  if (colonCount > 1 && !hostStr.startsWith("[")) {
    return { host: hostStr };
  }

  const host = hostStr.slice(0, lastColon);
  const port = hostStr.slice(lastColon + 1);
  return { host, port };
}

/** Execute a command on a remote host via SSH. */
export async function sshExec(
  hostStr: string,
  command: string,
  options: SshExecOptions = {},
): Promise<SshExecResult> {
  const { host, port } = parseHost(hostStr);

  const args: string[] = ["ssh"];

  // SSH config file
  const sshConfig = process.env.HIVEBOARD_SSH_CONFIG;
  if (sshConfig) {
    args.push("-F", sshConfig);
  }

  // Port
  if (port) {
    args.push("-p", port);
  }

  // Standard SSH options for non-interactive use
  args.push("-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new");

  args.push(host);
  args.push("bash", "-lc", `'${shellEscape(command)}'`);

  consola.debug(`SSH exec on ${hostStr}: ${command.slice(0, 80)}...`);

  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
  });

  const timeoutMs = options.timeoutMs ?? 120_000;

  const result = await Promise.race([
    proc.exited,
    new Promise<"timeout">((res) =>
      setTimeout(() => res("timeout"), timeoutMs),
    ),
  ]);

  if (result === "timeout") {
    proc.kill();
    throw new Error(`SSH command timed out after ${timeoutMs}ms on ${hostStr}`);
  }

  const stdout = await new Response(proc.stdout).text();

  return { stdout, exitCode: result };
}

/** Execute a command remotely via SSH, streaming output. */
export function sshSpawn(
  hostStr: string,
  command: string,
): ReturnType<typeof Bun.spawn> {
  const { host, port } = parseHost(hostStr);

  const args: string[] = ["ssh"];

  const sshConfig = process.env.HIVEBOARD_SSH_CONFIG;
  if (sshConfig) {
    args.push("-F", sshConfig);
  }

  if (port) {
    args.push("-p", port);
  }

  args.push("-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new");

  args.push(host);
  args.push("bash", "-lc", `'${shellEscape(command)}'`);

  return Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
  });
}
