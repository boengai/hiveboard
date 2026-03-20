import type { Orchestrator } from './orchestrator'

let _orchestrator: Orchestrator | null = null

export function setOrchestrator(o: Orchestrator | null): void {
  _orchestrator = o
}

export function getOrchestrator(): Orchestrator | null {
  return _orchestrator
}
