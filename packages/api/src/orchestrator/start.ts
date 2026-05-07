import { detectCheckpointSupport } from '../agent/capability'
import { loadWorkflow, setConfig } from '../config'
import { GitHubClient } from '../github/client'
import { WorkspaceManager } from '../workspace'
import { startCleanupInterval } from '../workspace/cleanup'
import { Orchestrator, setOrchestrator } from '.'

export async function startOrchestrator(): Promise<void> {
  await detectCheckpointSupport()
  try {
    const { config, promptTemplate } = await loadWorkflow()
    setConfig(config)
    const github = GitHubClient.create()
    // Generate initial token so process.env.GITHUB_TOKEN is set
    // before any agent spawns (gh/git need it immediately)
    await github.getAccessToken()
    const workspace = new WorkspaceManager(config)
    const orchestrator = new Orchestrator(
      config,
      github,
      workspace,
      promptTemplate,
    )
    setOrchestrator(orchestrator)
    orchestrator.start()
    // Start periodic cleanup of temp uploads + orphaned agent-state dirs
    startCleanupInterval(config)
  } catch (err) {
    console.warn(
      `Orchestrator not started (WORKFLOW.md not found or invalid): ${(err as Error).message}`,
    )
  }
}
