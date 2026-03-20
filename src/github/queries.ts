/** GraphQL queries and mutations for GitHub API. */

export const OWNER_TYPE_QUERY = `
  query($owner: String!) {
    repositoryOwner(login: $owner) {
      __typename
    }
  }
`;

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
