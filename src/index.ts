import { consola } from "consola";
import { loadWorkflow } from "./config/loader.ts";
import { GitHubClient } from "./github/client.ts";
import { Orchestrator } from "./orchestrator/orchestrator.ts";
import {
  startTunnel,
  stopTunnel,
  type TunnelResult,
} from "./tunnel/cloudflare.ts";
import { startWebhookServer } from "./webhook/server.ts";
import { WorkspaceManager } from "./workspace/manager.ts";

async function main() {
  const workflowPath = process.argv[2] ?? "WORKFLOW.md";

  consola.info(`HiveBoard starting (workflow: ${workflowPath})`);

  // Load config
  const { config, promptTemplate } = await loadWorkflow(workflowPath);

  // Initialize components
  const github = await GitHubClient.create(config);
  const workspace = new WorkspaceManager(config);
  const orchestrator = new Orchestrator(
    config,
    github,
    workspace,
    promptTemplate,
  );

  // Start webhook server
  const server = startWebhookServer({ config, orchestrator });

  // Start Cloudflare tunnel if enabled
  // CLOUDFLARE_TUNNEL=true  → quick tunnel (free *.trycloudflare.com URL)
  // CLOUDFLARE_TUNNEL_TOKEN → named tunnel (requires Cloudflare dashboard setup)
  let tunnel: TunnelResult | null = null;
  const tunnelEnabled =
    process.env.CLOUDFLARE_TUNNEL === "true" ||
    !!process.env.CLOUDFLARE_TUNNEL_TOKEN;
  if (tunnelEnabled) {
    tunnel = startTunnel({
      port: config.webhook.port,
      token: process.env.CLOUDFLARE_TUNNEL_TOKEN,
    });
    tunnel.url
      .then((url) => consola.box(`Webhook URL: ${url}/webhook`))
      .catch(() => {});
  }

  // Start orchestrator polling
  orchestrator.start();

  // Run initial poll immediately
  await orchestrator.poll();

  consola.info("HiveBoard is running");

  // Graceful shutdown
  const shutdown = async () => {
    consola.info("Received shutdown signal");
    if (tunnel) stopTunnel(tunnel.proc);
    server.stop();
    await orchestrator.shutdown();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  consola.fatal("HiveBoard failed to start:", err);
  process.exit(1);
});
