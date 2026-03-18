import { consola } from "consola";
import type { Config } from "../config/schema.ts";
import { parseRepoLabel } from "../labels/parse-repo.ts";
import type { Orchestrator } from "../orchestrator/orchestrator.ts";
import type { Issue } from "../types/issue.ts";

/** Payload shape from GitHub issues.labeled webhook event. */
export interface IssuesLabeledPayload {
  action: "labeled";
  issue: {
    id: number;
    node_id: string;
    number: number;
    title: string;
    body: string | null;
    state: string;
    html_url: string;
    assignee: { login: string } | null;
    labels: Array<{ name: string }>;
  };
  label: {
    name: string;
  };
  repository: {
    owner: { login: string };
    name: string;
  };
}

/** Payload shape from GitHub issues.unlabeled / issues.closed events. */
export interface IssuesEventPayload {
  action: string;
  issue: {
    id: number;
    node_id: string;
    number: number;
    title: string;
    body: string | null;
    state: string;
    html_url: string;
    assignee: { login: string } | null;
    labels: Array<{ name: string }>;
  };
  repository: {
    owner: { login: string };
    name: string;
  };
}

/** Convert webhook payload to our Issue model. */
function payloadToIssue(
  payload: IssuesLabeledPayload | IssuesEventPayload,
  config: Config,
): Issue {
  const gh = payload.issue;
  const labelNames = gh.labels.map((l) => l.name);
  const actionPrefix = config.tracker.labels.action_prefix;
  const repoPrefix = config.tracker.labels.repo_prefix;

  const actionLabel = labelNames.find((l) => l.startsWith(actionPrefix));
  const repo = parseRepoLabel(
    labelNames,
    repoPrefix,
    payload.repository.owner.login,
  );

  return {
    id: gh.node_id,
    projectItemId: null,
    number: gh.number,
    title: gh.title,
    body: gh.body ?? "",
    state: gh.state,
    labels: labelNames,
    labelIds: {},
    url: gh.html_url,
    assignee: gh.assignee?.login ?? null,
    sourceOwner: payload.repository.owner.login,
    sourceRepo: payload.repository.name,
    repoOwner: repo?.repoOwner ?? null,
    repoName: repo?.repoName ?? null,
    action: actionLabel ? actionLabel.slice(actionPrefix.length) : null,
  };
}

/** Handle issues.labeled event. */
export async function handleIssuesLabeled(
  payload: IssuesLabeledPayload,
  config: Config,
  orchestrator: Orchestrator,
): Promise<void> {
  const labelName = payload.label.name;
  const actionPrefix = config.tracker.labels.action_prefix;

  // Only trigger on action:* labels
  if (!labelName.startsWith(actionPrefix)) {
    consola.debug(
      `Ignoring non-action label: ${labelName} on issue #${payload.issue.number}`,
    );
    return;
  }

  const issue = payloadToIssue(payload, config);
  consola.info(
    `Webhook: issue #${issue.number} labeled with ${labelName} (action: ${issue.action})`,
  );

  await orchestrator.enqueueIssue(issue);
}

/** Handle issues.unlabeled or issues.closed events. */
export function handleIssuesCancellation(
  payload: IssuesEventPayload,
  orchestrator: Orchestrator,
): void {
  const issueId = payload.issue.node_id;
  consola.info(
    `Webhook: issue #${payload.issue.number} ${payload.action} — checking for running agent`,
  );
  orchestrator.cancelIssue(issueId);
}
