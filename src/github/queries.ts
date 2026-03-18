/** GraphQL queries and mutations for GitHub API. */

// ---------------------------------------------------------------------------
// Shared fragments (inner projectV2 shape is the same for repo and org)
// ---------------------------------------------------------------------------

const PROJECT_ITEMS_FRAGMENT = `
  projectV2(number: $projectNumber) {
    id
    items(first: 50, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        fieldValueByName(name: "Status") {
          ... on ProjectV2ItemFieldSingleSelectValue {
            name
          }
        }
        content {
          ... on Issue {
            id
            number
            title
            body
            state
            url
            repository {
              owner { login }
              name
            }
            assignees(first: 1) {
              nodes {
                login
              }
            }
            labels(first: 20) {
              nodes {
                id
                name
              }
            }
          }
        }
      }
    }
  }
`;

const PROJECT_FIELDS_FRAGMENT = `
  projectV2(number: $projectNumber) {
    id
    field(name: "Status") {
      ... on ProjectV2SingleSelectField {
        id
        options {
          id
          name
        }
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// Repo-scoped project queries
// ---------------------------------------------------------------------------

export const PROJECT_ITEMS_QUERY = `
  query($owner: String!, $repo: String!, $projectNumber: Int!, $cursor: String) {
    repository(owner: $owner, name: $repo) {
      ${PROJECT_ITEMS_FRAGMENT}
    }
  }
`;

export const PROJECT_FIELDS_QUERY = `
  query($owner: String!, $repo: String!, $projectNumber: Int!) {
    repository(owner: $owner, name: $repo) {
      ${PROJECT_FIELDS_FRAGMENT}
    }
  }
`;

// ---------------------------------------------------------------------------
// Org-scoped project queries
// ---------------------------------------------------------------------------

export const ORG_PROJECT_ITEMS_QUERY = `
  query($owner: String!, $projectNumber: Int!, $cursor: String) {
    organization(login: $owner) {
      ${PROJECT_ITEMS_FRAGMENT}
    }
  }
`;

export const ORG_PROJECT_FIELDS_QUERY = `
  query($owner: String!, $projectNumber: Int!) {
    organization(login: $owner) {
      ${PROJECT_FIELDS_FRAGMENT}
    }
  }
`;

// ---------------------------------------------------------------------------
// User-scoped project queries
// ---------------------------------------------------------------------------

export const USER_PROJECT_ITEMS_QUERY = `
  query($owner: String!, $projectNumber: Int!, $cursor: String) {
    user(login: $owner) {
      ${PROJECT_ITEMS_FRAGMENT}
    }
  }
`;

export const USER_PROJECT_FIELDS_QUERY = `
  query($owner: String!, $projectNumber: Int!) {
    user(login: $owner) {
      ${PROJECT_FIELDS_FRAGMENT}
    }
  }
`;

// ---------------------------------------------------------------------------
// Owner type detection
// ---------------------------------------------------------------------------

export const OWNER_TYPE_QUERY = `
  query($owner: String!) {
    repositoryOwner(login: $owner) {
      __typename
    }
  }
`;

// ---------------------------------------------------------------------------
// Project mutations
// ---------------------------------------------------------------------------

export const UPDATE_PROJECT_ITEM_STATUS = `
  mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $projectId,
      itemId: $itemId,
      fieldId: $fieldId,
      value: { singleSelectOptionId: $optionId }
    }) {
      projectV2Item {
        id
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// Label mutations
// ---------------------------------------------------------------------------

export const ADD_LABEL_MUTATION = `
  mutation($issueId: ID!, $labelIds: [ID!]!) {
    addLabelsToLabelable(input: {
      labelableId: $issueId,
      labelIds: $labelIds
    }) {
      labelable {
        ... on Issue {
          id
        }
      }
    }
  }
`;

export const REMOVE_LABEL_MUTATION = `
  mutation($issueId: ID!, $labelIds: [ID!]!) {
    removeLabelsFromLabelable(input: {
      labelableId: $issueId,
      labelIds: $labelIds
    }) {
      labelable {
        ... on Issue {
          id
        }
      }
    }
  }
`;

export const ADD_COMMENT_MUTATION = `
  mutation($issueId: ID!, $body: String!) {
    addComment(input: {
      subjectId: $issueId,
      body: $body
    }) {
      commentEdge {
        node {
          id
        }
      }
    }
  }
`;

export const GET_LABEL_ID_QUERY = `
  query($owner: String!, $repo: String!, $name: String!) {
    repository(owner: $owner, name: $repo) {
      label(name: $name) {
        id
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// PR review comments for an issue
// ---------------------------------------------------------------------------

/** Fetch the most recent linked PR and its review comments for an issue. */
export const ISSUE_LINKED_PR_REVIEWS_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) {
        timelineItems(itemTypes: [CROSS_REFERENCED_EVENT], first: 50) {
          nodes {
            ... on CrossReferencedEvent {
              source {
                ... on PullRequest {
                  number
                  url
                  state
                  reviews(last: 20) {
                    nodes {
                      author { login }
                      body
                      state
                      submittedAt
                      comments(first: 50) {
                        nodes {
                          author { login }
                          body
                          path
                          line
                          diffHunk
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

export const ISSUE_BY_NUMBER_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) {
        id
        number
        title
        body
        state
        url
        assignees(first: 1) {
          nodes {
            login
          }
        }
        labels(first: 20) {
          nodes {
            name
          }
        }
      }
    }
  }
`;
