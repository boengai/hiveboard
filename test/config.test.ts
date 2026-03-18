import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { loadWorkflow } from "../src/config/loader.ts";
import { ConfigSchema } from "../src/config/schema.ts";

describe("ConfigSchema", () => {
  test("parses minimal valid config with repo (repo-scoped project)", () => {
    const result = ConfigSchema.safeParse({
      tracker: {
        kind: "github",
        owner: "testorg",
        repo: "testrepo",
        project_number: 1,
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tracker.owner).toBe("testorg");
      expect(result.data.tracker.repo).toBe("testrepo");
      expect(result.data.polling.interval_ms).toBe(30_000);
      expect(result.data.agent.max_concurrent_agents).toBe(5);
      expect(result.data.webhook.port).toBe(8080);
    }
  });

  test("parses minimal valid config without repo (org-scoped project)", () => {
    const result = ConfigSchema.safeParse({
      tracker: {
        kind: "github",
        owner: "testorg",
        project_number: 1,
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tracker.owner).toBe("testorg");
      expect(result.data.tracker.repo).toBeUndefined();
    }
  });

  test("applies defaults for labels and columns", () => {
    const result = ConfigSchema.safeParse({
      tracker: {
        kind: "github",
        owner: "org",
        repo: "repo",
        project_number: 2,
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tracker.labels.action_prefix).toBe("action:");
      expect(result.data.tracker.labels.repo_prefix).toBe("repo:");
      expect(result.data.tracker.columns.in_progress).toBe("In Progress");
      expect(result.data.tracker.columns.review).toBe("Review");
    }
  });

  test("rejects missing tracker", () => {
    const result = ConfigSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  test("rejects invalid tracker kind", () => {
    const result = ConfigSchema.safeParse({
      tracker: {
        kind: "linear",
        owner: "org",
        repo: "repo",
        project_number: 1,
      },
    });
    expect(result.success).toBe(false);
  });

  test("resolves project_number from env variable string", () => {
    process.env.TEST_PROJECT_NUM = "5";
    const result = ConfigSchema.safeParse({
      tracker: {
        kind: "github",
        owner: "org",
        project_number: "$TEST_PROJECT_NUM",
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tracker.project_number).toBe(5);
    }
    delete process.env.TEST_PROJECT_NUM;
  });

  test("accepts project_number as raw number", () => {
    const result = ConfigSchema.safeParse({
      tracker: {
        kind: "github",
        owner: "org",
        project_number: 3,
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tracker.project_number).toBe(3);
    }
  });

  test("throws on unset environment variable", () => {
    delete process.env.NONEXISTENT_VAR;
    const result = ConfigSchema.safeParse({
      tracker: {
        kind: "github",
        owner: "$NONEXISTENT_VAR",
        project_number: 1,
      },
    });

    expect(result.success).toBe(false);
  });

  test("parses full config with all fields", () => {
    const result = ConfigSchema.safeParse({
      tracker: {
        kind: "github",
        owner: "org",
        repo: "repo",
        project_number: 3,
        labels: {
          action_prefix: "do:",
          repo_prefix: "target:",
          status_running: "wip",
          status_failed: "broken",
        },
        columns: {
          in_progress: "Working",
          review: "Pending Review",
          done: "Complete",
        },
      },
      polling: { interval_ms: 60_000 },
      workspace: { root: "/tmp/ws" },
      worker: {
        ssh_hosts: ["host1", "host2:2222"],
        max_concurrent_agents_per_host: 3,
      },
      claude: {
        command: "/usr/local/bin/claude",
        model: "opus",
        max_turns: 100,
        allowed_tools: ["Bash", "Read"],
        permission_mode: "auto",
      },
      agent: { max_concurrent_agents: 10, max_retry_backoff_ms: 600_000 },
      hooks: {
        after_create: "echo created",
        before_run: "echo before",
        timeout_ms: 30_000,
      },
      webhook: { port: 8080, host: "127.0.0.1", secret: "s3cret" },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tracker.labels.action_prefix).toBe("do:");
      expect(result.data.tracker.columns.done).toBe("Complete");
      expect(result.data.claude.model).toBe("opus");
      expect(result.data.worker.ssh_hosts).toEqual(["host1", "host2:2222"]);
    }
  });
});

describe("loadWorkflow", () => {
  test("loads WORKFLOW.md from repo root", async () => {
    const path = resolve(import.meta.dir, "../WORKFLOW.md");

    // Set required env vars for the test
    process.env.GITHUB_OWNER = "testorg";
    process.env.GITHUB_PROJECT_NUMBER = "5";
    process.env.GITHUB_WEBHOOK_SECRET = "test_secret";

    const { config, promptTemplate } = await loadWorkflow(path);

    expect(config.tracker.kind).toBe("github");
    expect(config.tracker.owner).toBe("testorg");
    expect(config.tracker.project_number).toBe(5);
    expect(config.tracker.repo).toBeUndefined();
    expect(promptTemplate).toContain("issue.number");
    expect(promptTemplate).toContain("issue.action");

    delete process.env.GITHUB_OWNER;
    delete process.env.GITHUB_PROJECT_NUMBER;
    delete process.env.GITHUB_WEBHOOK_SECRET;
  });

  test("rejects missing file", async () => {
    await expect(loadWorkflow("/nonexistent/WORKFLOW.md")).rejects.toThrow(
      "not found",
    );
  });
});
