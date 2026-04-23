type PlaybookUser = {
  id: string
  username: string
  displayName: string
}

export type PlaybookVersion = {
  id: string
  versionNumber: number
  promptTemplate: string
  defaultsJson: string
  allowedToolsOverride: string[] | null
  createdAt: string
  createdBy: PlaybookUser
}

export type Playbook = {
  id: string
  name: string
  displayName: string
  description: string
  archived: boolean
  createdAt: string
  currentVersion: PlaybookVersion
  versions: PlaybookVersion[]
}
