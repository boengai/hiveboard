import { type Subprocess, spawn } from "bun";
import { consola } from "consola";

export interface TunnelOptions {
  /** The local port to expose */
  port: number;
  /** Cloudflare tunnel token for named tunnels (optional — uses quick tunnel if omitted) */
  token?: string;
}

export interface TunnelResult {
  proc: Subprocess;
  /** Resolves with the public tunnel URL once cloudflared registers a connection. */
  url: Promise<string>;
}

/**
 * Starts a cloudflared tunnel that exposes a local port.
 * - With token: uses a named tunnel (hostname configured in Cloudflare dashboard).
 * - Without token: uses a free quick tunnel (random *.trycloudflare.com URL).
 */
export function startTunnel(options: TunnelOptions): TunnelResult {
  const { port, token } = options;

  const args = token
    ? ["cloudflared", "tunnel", "--no-autoupdate", "run", "--token", token]
    : [
        "cloudflared",
        "tunnel",
        "--no-autoupdate",
        "--url",
        `http://localhost:${port}`,
      ];

  consola.info(
    `Starting Cloudflare ${token ? "named" : "quick"} tunnel for port ${port}...`,
  );

  const proc = spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
  });

  let resolveUrl!: (url: string) => void;
  let rejectUrl!: (err: Error) => void;
  const url = new Promise<string>((resolve, reject) => {
    resolveUrl = resolve;
    rejectUrl = reject;
  });

  if (proc.stderr) {
    const reader = proc.stderr.getReader();
    const decoder = new TextDecoder();
    let urlResolved = false;
    (async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value).trim();
        if (!text) continue;
        for (const line of text.split("\n")) {
          if (line.includes("ERR")) {
            consola.error(`[cloudflared] ${line}`);
          } else {
            consola.debug(`[cloudflared] ${line}`);
          }

          // Quick tunnels log the URL like:
          //   "... https://random-words.trycloudflare.com ..."
          if (!urlResolved) {
            const quickMatch = line.match(
              /(https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com)/,
            );
            if (quickMatch) {
              urlResolved = true;
              resolveUrl(quickMatch[1] as string);
            }
          }

          // Named tunnels log "Registered tunnel connection"
          if (
            !urlResolved &&
            token &&
            line.includes("Registered tunnel connection")
          ) {
            urlResolved = true;
            resolveUrl("(see Cloudflare dashboard for URL)");
          }
        }
      }
    })();
  }

  proc.exited.then((code) => {
    if (code !== 0 && code !== null) {
      consola.error(`Cloudflare tunnel exited with code ${code}`);
      rejectUrl(new Error(`cloudflared exited with code ${code}`));
    } else {
      consola.info("Cloudflare tunnel stopped");
    }
  });

  return { proc, url };
}

/** Gracefully stop the tunnel process. */
export function stopTunnel(proc: Subprocess): void {
  consola.info("Stopping Cloudflare tunnel...");
  proc.kill("SIGTERM");
}
