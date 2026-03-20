/** GraphQL response types for GitHub API. */

/** Owner type detection response. */
export interface OwnerTypeResponse {
  repositoryOwner: { __typename: "User" | "Organization" } | null;
}

/** A single PR review comment (inline on a file). */
export interface ReviewComment {
  author: { login: string } | null;
  body: string;
  path: string | null;
  line: number | null;
  diffHunk: string | null;
}

/** A PR review (top-level review with optional inline comments). */
export interface PullRequestReview {
  author: { login: string } | null;
  body: string;
  state: string;
  submittedAt: string;
  comments: { nodes: ReviewComment[] };
}

/** A linked PR from the issue timeline. */
export interface LinkedPullRequest {
  number: number;
  url: string;
  state: string;
  reviews: { nodes: PullRequestReview[] };
}

/** Formatted review comment for prompt context. */
export interface FormattedReviewComment {
  author: string;
  body: string;
  path: string | null;
  line: number | null;
  diffHunk: string | null;
}

/** Response for ISSUE_LINKED_PR_REVIEWS_QUERY. */
export interface IssueLinkedPrReviewsResponse {
  repository: {
    issue: {
      timelineItems: {
        nodes: Array<{
          source?: LinkedPullRequest;
        }>;
      };
    };
  };
}
