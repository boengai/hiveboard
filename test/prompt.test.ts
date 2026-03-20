import { describe, expect, test } from "bun:test";
import { buildPromptContext, renderPrompt } from "../src/agent/prompt.ts";
import type { Issue } from "../src/types/issue.ts";

const testIssue: Issue = {
  id: "I_123",
  number: 42,
  title: "Fix the widget",
  body: "The widget is broken. Please fix it.",
  state: "open",
  labels: ["action:implement", "repo:hiveboard", "bug"],
  labelIds: {},
  url: "https://github.com/org/repo/issues/42",
  assignee: "alice",
  sourceOwner: "org",
  sourceRepo: "repo",
  repoOwner: "org",
  repoName: "hiveboard",
  action: "implement",
};

describe("buildPromptContext", () => {
  test("builds context from issue", () => {
    const ctx = buildPromptContext(testIssue);
    expect(ctx.issue.number).toBe(42);
    expect(ctx.issue.title).toBe("Fix the widget");
    expect(ctx.issue.labels).toBe("action:implement, repo:hiveboard, bug");
    expect(ctx.issue.action).toBe("implement");
    expect(ctx.issue.repo_name).toBe("hiveboard");
    expect(ctx.attempt).toBeUndefined();
  });

  test("includes attempt for retries", () => {
    const ctx = buildPromptContext(testIssue, 3);
    expect(ctx.attempt).toBe(3);
  });
});

describe("renderPrompt", () => {
  test("renders mustache template with issue data", () => {
    const template = "Issue #{{ issue.number }}: {{ issue.title }}";
    const result = renderPrompt(template, testIssue);
    expect(result).toBe("Issue #42: Fix the widget");
  });

  test("renders all issue fields", () => {
    const template = [
      "Action: {{ issue.action }}",
      "Repo: {{ issue.repo_owner }}/{{ issue.repo_name }}",
      "URL: {{ issue.url }}",
      "Body: {{ issue.body }}",
    ].join("\n");

    const result = renderPrompt(template, testIssue);
    expect(result).toContain("Action: implement");
    expect(result).toContain("Repo: org/hiveboard");
    expect(result).toContain("URL: https://github.com/org/repo/issues/42");
    expect(result).toContain("Body: The widget is broken");
  });

  test("does not HTML-escape content", () => {
    const issueWithHtml: Issue = {
      ...testIssue,
      body: '<script>alert("xss")</script>',
    };
    const template = "{{ issue.body }}";
    const result = renderPrompt(template, issueWithHtml);
    expect(result).toBe('<script>alert("xss")</script>');
  });
});
