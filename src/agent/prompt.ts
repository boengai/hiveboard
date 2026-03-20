import Mustache from "mustache";
import type { FormattedReviewComment } from "../github/types.ts";
import type { Issue } from "../types.ts";

/** Disable Mustache's default HTML escaping — we output plain text. */
Mustache.escape = (text: string) => text;

export interface PromptContext {
  issue: {
    id: string;
    number: number;
    title: string;
    body: string;
    state: string;
    labels: string;
    url: string;
    assignee: string;
    action: string;
    repo_owner: string;
    repo_name: string;
    source_owner: string;
    source_repo: string;
  };
  attempt?: number;
  review_comments?: string;
  has_review_comments?: boolean;
}

/** Format review comments into a readable text block for the prompt. */
function formatReviewComments(comments: FormattedReviewComment[]): string {
  if (comments.length === 0) return "";

  return comments
    .map((c) => {
      const lines: string[] = [];
      lines.push(`- @${c.author}:`);
      if (c.path) {
        lines.push(`  File: ${c.path}${c.line ? `:${c.line}` : ""}`);
      }
      if (c.diffHunk) {
        lines.push(`  Diff context:\n  \`\`\`\n  ${c.diffHunk}\n  \`\`\``);
      }
      lines.push(`  ${c.body}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

/** Build template context from an Issue. */
export function buildPromptContext(
  issue: Issue,
  attempt?: number,
  reviewComments?: FormattedReviewComment[],
): PromptContext {
  const formatted = reviewComments?.length
    ? formatReviewComments(reviewComments)
    : undefined;

  return {
    issue: {
      id: issue.id,
      number: issue.number,
      title: issue.title,
      body: issue.body,
      state: issue.state,
      labels: issue.labels.join(", "),
      url: issue.url,
      assignee: issue.assignee ?? "",
      action: issue.action ?? "",
      repo_owner: issue.repoOwner ?? "",
      repo_name: issue.repoName ?? "",
      source_owner: issue.sourceOwner ?? "",
      source_repo: issue.sourceRepo ?? "",
    },
    attempt,
    review_comments: formatted,
    has_review_comments: !!formatted,
  };
}

/** Render a Mustache template with issue context. */
export function renderPrompt(
  template: string,
  issue: Issue,
  attempt?: number,
  reviewComments?: FormattedReviewComment[],
): string {
  const context = buildPromptContext(issue, attempt, reviewComments);
  return Mustache.render(template, context);
}

/** Continuation prompt for retry turns. */
export const CONTINUATION_PROMPT = `
This is a continuation run. The workspace still contains your previous work.
Resume from the current state instead of starting from scratch.
Do not repeat already-completed work unless needed for new changes.
`.trim();
