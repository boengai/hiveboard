import { consola } from "consola";
import { loadWorkflow } from "./config/loader.ts";
import { GitHubClient } from "./github/client.ts";
import { Orchestrator } from "./orchestrator/orchestrator.ts";
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

  // Start orchestrator polling
  orchestrator.start();

  // Run initial poll immediately
  await orchestrator.poll();

  consola.info("HiveBoard is running");

  // Graceful shutdown
  const shutdown = async () => {
    consola.info("Received shutdown signal");
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
