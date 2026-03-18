import { z } from "zod/v4";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolves `$ENV_VAR` strings to their process.env value. */
function envString(fallback?: string) {
  return z
    .string()
    .optional()
    .transform((val, ctx) => {
      if (!val) return fallback;
      if (val.startsWith("$")) {
        const envVal = process.env[val.slice(1)];
        if (!envVal) {
          ctx.addIssue({
            code: "custom",
            message: `Environment variable ${val} is not set`,
          });
          return z.NEVER;
        }
        return envVal;
      }
      return val;
    });
}

/** A string that resolves env vars but is required. */
function envStringRequired() {
  return z.string().transform((val, ctx) => {
    if (val.startsWith("$")) {
      const envVal = process.env[val.slice(1)];
      if (!envVal) {
        ctx.addIssue({
          code: "custom",
          message: `Environment variable ${val} is not set`,
        });
        return z.NEVER;
      }
      return envVal;
    }
    return val;
  });
}

/** A positive integer that resolves `$ENV_VAR` strings and coerces to number. */
function envIntRequired() {
  return z.union([z.number(), z.string()]).transform((val, ctx) => {
    if (typeof val === "number") return val;
    let raw = val;
    if (raw.startsWith("$")) {
      const envVal = process.env[raw.slice(1)];
      if (!envVal) {
        ctx.addIssue({
          code: "custom",
          message: `Environment variable ${raw} is not set`,
        });
        return z.NEVER;
      }
      raw = envVal;
    }
    const num = Number.parseInt(raw, 10);
    if (Number.isNaN(num) || num <= 0) {
      ctx.addIssue({
        code: "custom",
        message: `Expected a positive integer, got "${raw}"`,
      });
      return z.NEVER;
    }
    return num;
  });
}

/**
 * Helper: make an object schema optional-with-defaults.
 * When the key is missing from input, use all field-level defaults.
 */
function objectWithDefaults<T extends z.ZodObject<z.ZodRawShape>>(schema: T) {
  return z.preprocess((val) => val ?? {}, schema) as unknown as T;
}

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

export const TrackerLabelsSchema = z.object({
  action_prefix: z.string().default("action:"),
  repo_prefix: z.string().default("repo:"),
  status_prefix: z.string().default("status:"),
  status_running: z.string().default("status:running"),
  status_failed: z.string().default("status:failed"),
});

export const TrackerColumnsSchema = z.object({
  backlog: z.string().default("Backlog"),
  todo: z.string().default("Todo"),
  in_progress: z.string().default("In Progress"),
  review: z.string().default("Review"),
  done: z.string().default("Done"),
});

export const TrackerSchema = z.object({
  kind: z.literal("github"),
  owner: envStringRequired(),
  /** Repository name. Required for repo-scoped projects, omit for org-scoped projects. */
  repo: envString(),
  project_number: envIntRequired(),
  labels: objectWithDefaults(TrackerLabelsSchema),
  columns: objectWithDefaults(TrackerColumnsSchema),
});

export const PollingSchema = z.object({
  interval_ms: z.number().int().positive().default(30_000),
});

export const WorkspaceSchema = z.object({
  root: z
    .string()
    .default("./workspaces")
    .transform((p) => {
      const { resolve } = require("node:path");
      return resolve(p);
    }),
  /** TTL in ms for stale workspaces. 0 = never expire. Default: 72 hours. */
  ttl_ms: z.number().int().nonnegative().default(259_200_000),
});

export const WorkerSchema = z.object({
  ssh_hosts: z.array(z.string()).default([]),
  max_concurrent_agents_per_host: z.number().int().positive().default(5),
});

export const ClaudeSchema = z.object({
  command: z.string().default("claude"),
  model: z.string().optional(),
  max_turns: z.number().int().positive().default(50),
  allowed_tools: z.array(z.string()).optional(),
  permission_mode: z.string().optional(),
});

export const AgentSchema = z.object({
  max_concurrent_agents: z.number().int().positive().default(5),
  max_retry_backoff_ms: z.number().int().positive().default(300_000),
});

export const HooksSchema = z.object({
  after_create: z.string().optional(),
  before_run: z.string().optional(),
  after_run: z.string().optional(),
  before_remove: z.string().optional(),
  timeout_ms: z.number().int().positive().default(60_000),
});

export const WebhookSchema = z.object({
  port: z.number().int().positive().default(8080),
  host: z.string().default("0.0.0.0"),
  secret: envString(),
});

// ---------------------------------------------------------------------------
// Root schema
// ---------------------------------------------------------------------------

export const ConfigSchema = z.object({
  tracker: TrackerSchema,
  polling: objectWithDefaults(PollingSchema),
  workspace: objectWithDefaults(WorkspaceSchema),
  worker: objectWithDefaults(WorkerSchema),
  claude: objectWithDefaults(ClaudeSchema),
  agent: objectWithDefaults(AgentSchema),
  hooks: objectWithDefaults(HooksSchema),
  webhook: objectWithDefaults(WebhookSchema),
});

export type Config = z.infer<typeof ConfigSchema>;
export type TrackerConfig = z.infer<typeof TrackerSchema>;
export type TrackerLabels = z.infer<typeof TrackerLabelsSchema>;
export type TrackerColumns = z.infer<typeof TrackerColumnsSchema>;
export type PollingConfig = z.infer<typeof PollingSchema>;
export type WorkspaceConfig = z.infer<typeof WorkspaceSchema>;
export type WorkerConfig = z.infer<typeof WorkerSchema>;
export type ClaudeConfig = z.infer<typeof ClaudeSchema>;
export type AgentConfig = z.infer<typeof AgentSchema>;
export type HooksConfig = z.infer<typeof HooksSchema>;
export type WebhookConfig = z.infer<typeof WebhookSchema>;
