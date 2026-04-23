export const PLAYBOOK_VERSION_FIELDS = /* GraphQL */ `
  fragment PlaybookVersionFields on PlaybookVersion {
    id
    versionNumber
    promptTemplate
    defaultsJson
    allowedToolsOverride
    createdAt
    createdBy {
      id
      username
      displayName
    }
  }
`

export const PLAYBOOK_FIELDS = /* GraphQL */ `
  ${PLAYBOOK_VERSION_FIELDS}
  fragment PlaybookFields on Playbook {
    id
    name
    displayName
    description
    archived
    createdAt
    currentVersion { ...PlaybookVersionFields }
    versions { ...PlaybookVersionFields }
  }
`
