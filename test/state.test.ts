import { describe, expect, test } from "bun:test";
import {
  createInitialState,
  isEligible,
  runningCount,
} from "../src/orchestrator/state.ts";
import type { Issue, RunState } from "../src/types/issue.ts";

const makeIssue = (id: string, action: string | null = "implement"): Issue => ({
  id,
  number: 1,
  title: "Test",
  body: "",
  state: "open",
  labels: [],
  labelIds: {},
  url: "",
  assignee: null,
  sourceOwner: "test-org",
  sourceRepo: "test-repo",
  repoOwner: null,
  repoName: null,
  action,
});

const makeRunState = (
  issueId: string,
  workerHost: string | null = null,
): RunState => ({
  issueId,
  issue: makeIssue(issueId),
  process: null,
  workerHost,
  workspacePath: null,
  retryAttempt: 0,
  startedAt: new Date(),
  abortController: new AbortController(),
});

describe("createInitialState", () => {
  test("creates empty state", () => {
    const state = createInitialState();
    expect(state.running.size).toBe(0);
    expect(state.completed.size).toBe(0);
    expect(state.retryAttempts.size).toBe(0);
  });
});

describe("isEligible", () => {
  test("eligible issue with action", () => {
    const state = createInitialState();
    expect(isEligible(state, makeIssue("i1"))).toBe(true);
  });

  test("ineligible: no action", () => {
    const state = createInitialState();
    expect(isEligible(state, makeIssue("i1", null))).toBe(false);
  });

  test("ineligible: already running", () => {
    const state = createInitialState();
    state.running.set("i1", makeRunState("i1"));
    expect(isEligible(state, makeIssue("i1"))).toBe(false);
  });

  test("ineligible: already completed", () => {
    const state = createInitialState();
    state.completed.add("i1:implement");
    expect(isEligible(state, makeIssue("i1"))).toBe(false);
  });
});

describe("runningCount", () => {
  test("counts all running", () => {
    const state = createInitialState();
    state.running.set("i1", makeRunState("i1"));
    state.running.set("i2", makeRunState("i2"));
    expect(runningCount(state)).toBe(2);
  });

  test("counts by worker host", () => {
    const state = createInitialState();
    state.running.set("i1", makeRunState("i1", "host1"));
    state.running.set("i2", makeRunState("i2", "host1"));
    state.running.set("i3", makeRunState("i3", "host2"));
    expect(runningCount(state, "host1")).toBe(2);
    expect(runningCount(state, "host2")).toBe(1);
    expect(runningCount(state, null)).toBe(0);
  });
});
