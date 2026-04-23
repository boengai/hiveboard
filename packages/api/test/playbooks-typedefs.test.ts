import { describe, expect, it } from 'bun:test'
import { typeDefs } from '../src/schema/typeDefs'

describe('Playbook GraphQL types', () => {
  it('declares Playbook type with id/name/displayName/description/currentVersion/versions/archived', () => {
    expect(typeDefs).toMatch(/type Playbook \{[^}]+name: String![^}]+\}/s)
    expect(typeDefs).toMatch(/currentVersion:\s*PlaybookVersion!/)
    expect(typeDefs).toMatch(/versions:\s*\[PlaybookVersion!\]!/)
    expect(typeDefs).toMatch(/archived:\s*Boolean!/)
  })

  it('declares PlaybookVersion type with versionNumber/promptTemplate/defaultsJson/allowedToolsOverride/createdBy', () => {
    expect(typeDefs).toMatch(/type PlaybookVersion \{[^}]+\}/s)
    expect(typeDefs).toMatch(/versionNumber:\s*Int!/)
    expect(typeDefs).toMatch(/promptTemplate:\s*String!/)
    expect(typeDefs).toMatch(/defaultsJson:\s*String!/)
    expect(typeDefs).toMatch(/allowedToolsOverride:\s*\[String!\]/)
    expect(typeDefs).toMatch(/createdBy:\s*User!/)
  })

  it('declares playbooks query and CRUD mutations', () => {
    expect(typeDefs).toMatch(/playbooks:\s*\[Playbook!\]!/)
    expect(typeDefs).toMatch(/createPlaybook\(input: CreatePlaybookInput!\):\s*Playbook!/)
    expect(typeDefs).toMatch(/updatePlaybook\(id: ID!, input: UpdatePlaybookInput!\):\s*Playbook!/)
    expect(typeDefs).toMatch(/archivePlaybook\(id: ID!\):\s*Playbook!/)
    expect(typeDefs).toMatch(/unarchivePlaybook\(id: ID!\):\s*Playbook!/)
  })
})
