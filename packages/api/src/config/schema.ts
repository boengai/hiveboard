import { z } from 'zod/v4'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Helper: make an object schema optional-with-defaults.
 * When the key is missing from input, use all field-level defaults.
 */
function objectWithDefaults<T extends z.ZodObject<z.ZodRawShape>>(schema: T) {
  return z.preprocess((val) => val ?? {}, schema) as unknown as T
}

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

export const PollingSchema = z.object({
  interval_ms: z.number().int().positive().default(5_000),
})

export const WorkspaceSchema = z.object({
  root: z
    .string()
    .default('./workspaces')
    .transform((p) => {
      const { resolve } = require('node:path')
      return resolve(p)
    }),
  /** TTL in ms for stale workspaces. 0 = never expire. Default: 72 hours. */
  ttl_ms: z.number().int().nonnegative().default(259_200_000),
})

export const ClaudeSchema = z.object({
  allowed_tools: z.array(z.string()).optional(),
  command: z.string().default('claude'),
  max_turns: z.number().int().positive().default(50),
  model: z.string().optional(),
  permission_mode: z.string().optional(),
})

export const AgentSchema = z.object({
  max_concurrent_agents: z.number().int().positive().default(5),
  max_retry_backoff_ms: z.number().int().positive().default(300_000),
  state_root: z
    .string()
    .default('./tmp/agent-state')
    .transform((p) => {
      const { resolve } = require('node:path')
      return resolve(p)
    }),
})

export const HooksSchema = z.object({
  after_create: z.string().optional(),
  after_run: z.string().optional(),
  before_remove: z.string().optional(),
  before_run: z.string().optional(),
  timeout_ms: z.number().int().positive().default(60_000),
})

export const VerifyCommandSchema = z.object({
  label: z.string().min(1),
  run: z.string().min(1),
  timeout_ms: z.number().int().positive().default(300_000),
})

export const VerifySchema = z.object({
  commands: z.array(VerifyCommandSchema).default([]),
  enabled: z.boolean().default(true),
  max_auto_revises: z.number().int().nonnegative().default(1),
})

export const ProgressSchema = z.object({
  enabled: z.boolean().default(true),
  snapshot_disk_budget_mb: z.number().int().positive().default(10),
  snapshot_interval_ms: z.number().int().positive().default(15_000),
})

// ---------------------------------------------------------------------------
// Root schema
// ---------------------------------------------------------------------------

export const ConfigSchema = z.object({
  agent: objectWithDefaults(AgentSchema),
  claude: objectWithDefaults(ClaudeSchema),
  hooks: objectWithDefaults(HooksSchema),
  polling: objectWithDefaults(PollingSchema),
  progress: objectWithDefaults(ProgressSchema),
  verify: objectWithDefaults(VerifySchema),
  workspace: objectWithDefaults(WorkspaceSchema),
})

export type Config = z.infer<typeof ConfigSchema>
export type PollingConfig = z.infer<typeof PollingSchema>
export type WorkspaceConfig = z.infer<typeof WorkspaceSchema>
export type ClaudeConfig = z.infer<typeof ClaudeSchema>
export type AgentConfig = z.infer<typeof AgentSchema>
export type HooksConfig = z.infer<typeof HooksSchema>
export type ProgressConfig = z.infer<typeof ProgressSchema>
export type VerifyConfig = z.infer<typeof VerifySchema>
export type VerifyCommand = z.infer<typeof VerifyCommandSchema>
