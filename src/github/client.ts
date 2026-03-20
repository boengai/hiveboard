import { createAppAuth } from "@octokit/auth-app";
import { consola } from "consola";
import { Octokit } from "octokit";
import type { Config } from "../config/schema.ts";
import type { Issue } from "../types.ts";
import {
  ISSUE_LINKED_PR_REVIEWS_QUERY,
} from "./queries.ts";
import type {
  FormattedReviewComment,
  IssueLinkedPrReviewsResponse,
} from "./types.ts";


export class GitHubClient {
  private owner: string;
  private repo: string | undefined;

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
      const token = await client.getInstallationToken();
      if (client.isAppAuth) {
        process.env.GITHUB_TOKEN = token;
      }

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
    const token = await this.getInstallationToken();
    if (this.isAppAuth) {
      process.env.GITHUB_TOKEN = token;
    }
    return token;
  }

  // -------------------------------------------------------------------------
  // Review comments
  // -------------------------------------------------------------------------

  /**
   * Resolve owner/repo for API calls.
   * Uses the issue's source repository if available, otherwise falls back to config.
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
    throw new Error("Cannot resolve repository for API call.");
  }

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
}
