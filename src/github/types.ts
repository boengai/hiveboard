/** GraphQL response types for GitHub Projects V2. */

export interface ProjectItemNode {
  id: string;
  fieldValueByName: {
    name: string;
  } | null;
  content: {
    id: string;
    number: number;
    title: string;
    body: string;
    state: string;
    url: string;
    repository: {
      owner: { login: string };
      name: string;
    };
    assignees: {
      nodes: Array<{ login: string }>;
    };
    labels: {
      nodes: Array<{ id: string; name: string }>;
    };
  } | null;
}

export interface ProjectFieldOption {
  id: string;
  name: string;
}

/** Inner projectV2 shape shared by both repo and org responses. */
export interface ProjectV2Fields {
  id: string;
  field: {
    id: string;
    options: ProjectFieldOption[];
  };
}

export interface ProjectV2Items {
  id: string;
  items: {
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string | null;
    };
    nodes: ProjectItemNode[];
  };
}

/** Repo-scoped response. */
export interface ProjectFieldsResponse {
  repository: { projectV2: ProjectV2Fields };
}

/** Org-scoped response. */
export interface OrgProjectFieldsResponse {
  organization: { projectV2: ProjectV2Fields };
}

/** Repo-scoped response. */
export interface ProjectItemsResponse {
  repository: { projectV2: ProjectV2Items };
}

/** Org-scoped response. */
export interface OrgProjectItemsResponse {
  organization: { projectV2: ProjectV2Items };
}

/** User-scoped response. */
export interface UserProjectFieldsResponse {
  user: { projectV2: ProjectV2Fields };
}

/** User-scoped response. */
export interface UserProjectItemsResponse {
  user: { projectV2: ProjectV2Items };
}

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
