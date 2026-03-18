import { createAppAuth } from "@octokit/auth-app";
import { consola } from "consola";
import { Octokit } from "octokit";
import type { Config, TrackerLabels } from "../config/schema.ts";
import { parseRepoLabel } from "../labels/parse-repo.ts";
import type { Issue } from "../types/issue.ts";
import {
  ADD_COMMENT_MUTATION,
  ADD_LABEL_MUTATION,
  GET_LABEL_ID_QUERY,
  ISSUE_LINKED_PR_REVIEWS_QUERY,
  ORG_PROJECT_FIELDS_QUERY,
  ORG_PROJECT_ITEMS_QUERY,
  OWNER_TYPE_QUERY,
  PROJECT_FIELDS_QUERY,
  PROJECT_ITEMS_QUERY,
  REMOVE_LABEL_MUTATION,
  UPDATE_PROJECT_ITEM_STATUS,
  USER_PROJECT_FIELDS_QUERY,
  USER_PROJECT_ITEMS_QUERY,
} from "./queries.ts";
import type {
  FormattedReviewComment,
  IssueLinkedPrReviewsResponse,
  OrgProjectFieldsResponse,
  OrgProjectItemsResponse,
  OwnerTypeResponse,
  ProjectFieldOption,
  ProjectFieldsResponse,
  ProjectItemNode,
  ProjectItemsResponse,
  ProjectV2Fields,
  ProjectV2Items,
  UserProjectFieldsResponse,
  UserProjectItemsResponse,
} from "./types.ts";

type OwnerKind = "repo" | "org" | "user";

const LABEL_PREFIX_COLORS: Record<string, string> = {
  "action:": "5319e7", // purple
  "status:": "0e8a16", // green
  "repo:": "006b75", // teal
  "priority:": "d93f0b", // red-orange
};

/** Pick a default color based on label prefix, or fall back to grey. */
function defaultLabelColor(name: string): string {
  for (const [prefix, color] of Object.entries(LABEL_PREFIX_COLORS)) {
    if (name.startsWith(prefix)) return color;
  }
  return "ededed"; // light grey
}

export class GitHubClient {
  private owner: string;
  private repo: string | undefined;
  private projectNumber: number;
  private labels: TrackerLabels;

  /** Resolved at first API call: "repo" | "org" | "user". */
  private ownerKind: OwnerKind | null = null;

  /** Cached project metadata. */
  private projectId: string | null = null;
  private statusFieldId: string | null = null;
  private statusOptions: ProjectFieldOption[] = [];

  /** True when using GitHub App auth (token needs periodic refresh). */
  private isAppAuth: boolean;

  private constructor(
    private octokit: Octokit,
    private getInstallationToken: () => Promise<string>,
    config: Config,
    isAppAuth: boolean,
  ) {
    this.owner = config.tracker.owner;
    this.repo = config.tracker.repo;
    this.projectNumber = config.tracker.project_number;
    this.labels = config.tracker.labels;
    this.isAppAuth = isAppAuth;
  }

  /**
   * Create a GitHubClient with auth auto-detected from env vars:
   * - GITHUB_TOKEN → PAT mode
   * - GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY + GITHUB_APP_INSTALLATION_ID → App mode
   */
  static async create(config: Config): Promise<GitHubClient> {
    const pat = process.env.GITHUB_TOKEN;
    const appId = process.env.GITHUB_APP_ID;
    const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
    const installationId = process.env.GITHUB_APP_INSTALLATION_ID;

    if (pat) {
      // PAT mode
      const octokit = new Octokit({ auth: pat });
      const getToken = async () => pat;
      consola.debug("GitHub client initialized with PAT auth");
      return new GitHubClient(octokit, getToken, config, false);
    }

    if (appId && privateKey && installationId) {
      // GitHub App mode
      const octokit = new Octokit({
        authStrategy: createAppAuth,
        auth: { appId, privateKey, installationId: Number(installationId) },
      });

      const getToken = async () => {
        const auth = (await octokit.auth({
          type: "installation",
        })) as { token: string };
        return auth.token;
      };

      const client = new GitHubClient(octokit, getToken, config, true);

      // Generate initial token and set process.env.GITHUB_TOKEN
      await client.refreshToken();

      consola.debug("GitHub client initialized with GitHub App auth");
      return client;
    }

    throw new Error(
      "GitHub auth not configured. Set GITHUB_TOKEN, or set all of " +
        "GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, and GITHUB_APP_INSTALLATION_ID.",
    );
  }

  /**
   * Get a fresh access token (for injection into hook env).
   * Also updates process.env.GITHUB_TOKEN so external tools (gh, git) work.
   */
  async getAccessToken(): Promise<string> {
    return this.refreshToken();
  }

  /**
   * Refresh the installation token and update process.env.GITHUB_TOKEN.
   * Called automatically at each poll cycle for App auth.
   * No-op for PAT auth (token is static).
   */
  async refreshToken(): Promise<string> {
    const token = await this.getInstallationToken();
    if (this.isAppAuth) {
      process.env.GITHUB_TOKEN = token;
    }
    return token;
  }

  // -------------------------------------------------------------------------
  // Owner type detection
  // -------------------------------------------------------------------------

  /** Detect and cache whether the owner is a repo-scoped project, org, or user. */
  private async resolveOwnerKind(): Promise<OwnerKind> {
    if (this.ownerKind) return this.ownerKind;

    // If repo is set, it's a repo-scoped project — no detection needed
    if (this.repo) {
      this.ownerKind = "repo";
      return this.ownerKind;
    }

    const resp = await this.octokit.graphql<OwnerTypeResponse>(
      OWNER_TYPE_QUERY,
      { owner: this.owner },
    );

    if (!resp.repositoryOwner) {
      throw new Error(`GitHub owner "${this.owner}" not found`);
    }

    this.ownerKind =
      resp.repositoryOwner.__typename === "Organization" ? "org" : "user";

    consola.debug(
      `Owner "${this.owner}" detected as ${this.ownerKind} (${resp.repositoryOwner.__typename})`,
    );
    return this.ownerKind;
  }

  // -------------------------------------------------------------------------
  // Project metadata
  // -------------------------------------------------------------------------

  /** Fetch and cache project ID, status field ID, and status options. */
  async ensureProjectMeta(): Promise<void> {
    if (this.projectId) return;

    const kind = await this.resolveOwnerKind();
    consola.info(
      `Fetching project metadata: owner=${this.owner}, kind=${kind}, projectNumber=${this.projectNumber}`,
    );
    let projectV2: ProjectV2Fields;

    if (kind === "org") {
      const resp = await this.octokit.graphql<OrgProjectFieldsResponse>(
        ORG_PROJECT_FIELDS_QUERY,
        { owner: this.owner, projectNumber: this.projectNumber },
      );
      projectV2 = resp.organization.projectV2;
    } else if (kind === "user") {
      const resp = await this.octokit.graphql<UserProjectFieldsResponse>(
        USER_PROJECT_FIELDS_QUERY,
        { owner: this.owner, projectNumber: this.projectNumber },
      );
      projectV2 = resp.user.projectV2;
    } else {
      const resp = await this.octokit.graphql<ProjectFieldsResponse>(
        PROJECT_FIELDS_QUERY,
        {
          owner: this.owner,
          repo: this.repo,
          projectNumber: this.projectNumber,
        },
      );
      projectV2 = resp.repository.projectV2;
    }

    this.projectId = projectV2.id;
    this.statusFieldId = projectV2.field.id;
    this.statusOptions = projectV2.field.options;

    consola.debug(
      `Project ${this.projectId} (${kind}): ${this.statusOptions.length} status options`,
    );
  }

  // -------------------------------------------------------------------------
  // Issue queries
  // -------------------------------------------------------------------------

  /** Fetch all project items (issues) with pagination. */
  async fetchProjectItems(): Promise<Issue[]> {
    await this.ensureProjectMeta();

    const kind = await this.resolveOwnerKind();
    const issues: Issue[] = [];
    let cursor: string | null = null;
    let hasNext = true;

    while (hasNext) {
      const projectV2 = await this.fetchProjectPage(kind, cursor);
      const items = projectV2.items;

      for (const node of items.nodes) {
        const issue = this.nodeToIssue(node);
        if (issue) issues.push(issue);
      }

      hasNext = items.pageInfo.hasNextPage;
      cursor = items.pageInfo.endCursor;
    }

    return issues;
  }

  /** Fetch a single page of project items for the resolved owner kind. */
  private async fetchProjectPage(
    kind: OwnerKind,
    cursor: string | null,
  ): Promise<ProjectV2Items> {
    if (kind === "org") {
      const resp = await this.octokit.graphql<OrgProjectItemsResponse>(
        ORG_PROJECT_ITEMS_QUERY,
        { owner: this.owner, projectNumber: this.projectNumber, cursor },
      );
      return resp.organization.projectV2;
    }
    if (kind === "user") {
      const resp = await this.octokit.graphql<UserProjectItemsResponse>(
        USER_PROJECT_ITEMS_QUERY,
        { owner: this.owner, projectNumber: this.projectNumber, cursor },
      );
      return resp.user.projectV2;
    }
    const resp = await this.octokit.graphql<ProjectItemsResponse>(
      PROJECT_ITEMS_QUERY,
      {
        owner: this.owner,
        repo: this.repo,
        projectNumber: this.projectNumber,
        cursor,
      },
    );
    return resp.repository.projectV2;
  }

  /** Convert a raw project item node to our Issue model. */
  private nodeToIssue(node: ProjectItemNode): Issue | null {
    if (!node.content) return null;

    const c = node.content;
    const labelNames = c.labels.nodes.map((l) => l.name);
    const labelIds: Record<string, string> = {};
    for (const l of c.labels.nodes) {
      labelIds[l.name] = l.id;
    }

    const repo = parseRepoLabel(
      labelNames,
      this.labels.repo_prefix,
      this.owner,
    );

    return {
      id: c.id,
      projectItemId: node.id,
      number: c.number,
      title: c.title,
      body: c.body,
      state: node.fieldValueByName?.name ?? c.state,
      labels: labelNames,
      labelIds,
      url: c.url,
      assignee: c.assignees.nodes[0]?.login ?? null,
      sourceOwner: c.repository.owner.login,
      sourceRepo: c.repository.name,
      repoOwner: repo?.repoOwner ?? null,
      repoName: repo?.repoName ?? null,
      action: this.extractLabel(labelNames, this.labels.action_prefix),
    };
  }

  /** Extract the value part from a prefixed label. e.g. "action:implement" → "implement" */
  private extractLabel(labels: string[], prefix: string): string | null {
    const match = labels.find((l) => l.startsWith(prefix));
    return match ? match.slice(prefix.length) : null;
  }

  /**
   * Find the project item ID (PVTI_...) for an issue by its node ID.
   * Searches through project items to find the matching one.
   */
  async findProjectItemId(issueNodeId: string): Promise<string | null> {
    const items = await this.fetchProjectItems();
    const match = items.find((i) => i.id === issueNodeId);
    return match?.projectItemId ?? null;
  }

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  /**
   * Move a project item to a different status column.
   * NOTE: GitHub Projects V2 API does not support creating single-select
   * field options programmatically — columns must be added via the GitHub UI.
   */
  async moveToColumn(itemId: string, columnName: string): Promise<void> {
    await this.ensureProjectMeta();

    const option = this.statusOptions.find((o) => o.name === columnName);
    if (!option) {
      const available = this.statusOptions.map((o) => o.name).join(", ");
      throw new Error(
        `Column "${columnName}" not found in project. Available columns: [${available}]. ` +
          `Add it manually in your GitHub Project's Status field settings — ` +
          `the API does not support auto-creating column options.`,
      );
    }

    await this.octokit.graphql(UPDATE_PROJECT_ITEM_STATUS, {
      projectId: this.projectId,
      itemId,
      fieldId: this.statusFieldId,
      optionId: option.id,
    });

    consola.debug(`Moved item ${itemId} to "${columnName}"`);
  }

  /**
   * Resolve owner/repo for label lookups.
   * Labels live on the issue's source repository, not the target repo from repo:*.
   */
  private resolveLabelRepo(issue?: Issue): {
    owner: string;
    repo: string;
  } {
    if (issue?.sourceOwner && issue?.sourceRepo) {
      return { owner: issue.sourceOwner, repo: issue.sourceRepo };
    }
    if (this.repo) {
      return { owner: this.owner, repo: this.repo };
    }
    throw new Error("Cannot resolve repository for label lookup.");
  }

  /**
   * Resolve a label name to its node ID.
   * First checks issue.labelIds (from GraphQL query), then falls back to repo lookup.
   */
  private async resolveLabelId(name: string, issue?: Issue): Promise<string> {
    // Fast path: label ID already known from the issue's own labels
    if (issue?.labelIds[name]) return issue.labelIds[name];

    // Fallback: look up from the source repo
    const { owner, repo } = this.resolveLabelRepo(issue);
    const resp = await this.octokit.graphql<{
      repository: { label: { id: string } | null };
    }>(GET_LABEL_ID_QUERY, { owner, repo, name });

    const id = resp.repository.label?.id;
    if (!id) {
      return this.createLabel(owner, repo, name);
    }
    return id;
  }

  /** Create a label in the repo and return its node ID. */
  private async createLabel(
    owner: string,
    repo: string,
    name: string,
  ): Promise<string> {
    const color = defaultLabelColor(name);
    const resp = await this.octokit.rest.issues.createLabel({
      owner,
      repo,
      name,
      color,
    });
    consola.info(
      `Created label "${name}" in ${owner}/${repo} (color: #${color})`,
    );
    return resp.data.node_id;
  }

  /** Add labels to an issue by label names (GraphQL). */
  async addLabels(
    issueId: string,
    labelNames: string[],
    issue?: Issue,
  ): Promise<void> {
    const labelIds = await Promise.all(
      labelNames.map((n) => this.resolveLabelId(n, issue)),
    );
    await this.octokit.graphql(ADD_LABEL_MUTATION, { issueId, labelIds });
    consola.debug(`Added labels [${labelNames.join(", ")}] to ${issueId}`);
  }

  /** Remove labels from an issue by label names (GraphQL). */
  async removeLabels(
    issueId: string,
    labelNames: string[],
    issue?: Issue,
  ): Promise<void> {
    const labelIds = (
      await Promise.all(
        labelNames.map(async (n) => {
          try {
            return await this.resolveLabelId(n, issue);
          } catch {
            consola.debug(`Label "${n}" not found, skipping removal`);
            return null;
          }
        }),
      )
    ).filter((id): id is string => id !== null);

    if (labelIds.length === 0) return;
    await this.octokit.graphql(REMOVE_LABEL_MUTATION, { issueId, labelIds });
    consola.debug(`Removed labels [${labelNames.join(", ")}] from ${issueId}`);
  }

  /** Add a comment to an issue. */
  async addComment(issueId: string, body: string): Promise<void> {
    await this.octokit.graphql(ADD_COMMENT_MUTATION, { issueId, body });
    consola.debug(`Added comment to ${issueId}`);
  }

  // -------------------------------------------------------------------------
  // Review comments
  // -------------------------------------------------------------------------

  /**
   * Fetch PR review comments linked to an issue.
   * Finds the most recent open (or merged) PR cross-referenced from the issue
   * and returns all review comments from CHANGES_REQUESTED or COMMENTED reviews.
   */
  async fetchReviewComments(issue: Issue): Promise<FormattedReviewComment[]> {
    const { owner, repo } = this.resolveLabelRepo(issue);

    const resp = await this.octokit.graphql<IssueLinkedPrReviewsResponse>(
      ISSUE_LINKED_PR_REVIEWS_QUERY,
      { owner, repo, number: issue.number },
    );

    const timelineNodes = resp.repository.issue.timelineItems.nodes;

    // Find linked PRs (prefer OPEN, then MERGED)
    const linkedPRs = timelineNodes
      .filter(
        (n): n is { source: NonNullable<(typeof n)["source"]> } =>
          n.source?.number != null,
      )
      .map((n) => n.source);

    const pr =
      linkedPRs.find((p) => p.state === "OPEN") ??
      linkedPRs.find((p) => p.state === "MERGED") ??
      linkedPRs[linkedPRs.length - 1];

    if (!pr) {
      consola.debug(`No linked PR found for issue #${issue.number}`);
      return [];
    }

    consola.debug(`Found linked PR #${pr.number} for issue #${issue.number}`);

    const comments: FormattedReviewComment[] = [];

    for (const review of pr.reviews.nodes) {
      // Include top-level review body if present
      if (
        review.body?.trim() &&
        (review.state === "CHANGES_REQUESTED" || review.state === "COMMENTED")
      ) {
        comments.push({
          author: review.author?.login ?? "unknown",
          body: review.body.trim(),
          path: null,
          line: null,
          diffHunk: null,
        });
      }

      // Include inline review comments
      for (const c of review.comments.nodes) {
        if (!c.body?.trim()) continue;
        comments.push({
          author: c.author?.login ?? "unknown",
          body: c.body.trim(),
          path: c.path ?? null,
          line: c.line ?? null,
          diffHunk: c.diffHunk ?? null,
        });
      }
    }

    consola.info(
      `Fetched ${comments.length} review comments from PR #${pr.number} for issue #${issue.number}`,
    );

    return comments;
  }

  // -------------------------------------------------------------------------
  // Label helpers
  // -------------------------------------------------------------------------

  /** Build the full action label name (e.g. "action:implement"). */
  actionLabel(action: string): string {
    return `${this.labels.action_prefix}${action}`;
  }

  /** Build the full repo label name (e.g. "repo:hiveboard"). */
  repoLabel(repo: string): string {
    return `${this.labels.repo_prefix}${repo}`;
  }

  get runningLabel(): string {
    return this.labels.status_running;
  }

  get failedLabel(): string {
    return this.labels.status_failed;
  }

  private get allStatusLabels(): string[] {
    return [this.labels.status_running, this.labels.status_failed];
  }

  /**
   * Set a status label on an issue, removing any other status:* labels first.
   * Ensures only one status label exists at a time.
   * Pass `null` to just remove all status labels without adding a new one.
   */
  async setStatusLabel(
    issueId: string,
    label: string | null,
    issue?: Issue,
  ): Promise<void> {
    // Use allStatusLabels (not issue.labels which may be stale)
    const toRemove = this.allStatusLabels.filter((l) => l !== label);
    if (toRemove.length > 0) {
      await this.removeLabels(issueId, toRemove, issue);
    }
    if (label) {
      await this.addLabels(issueId, [label], issue);
    }
  }
}
