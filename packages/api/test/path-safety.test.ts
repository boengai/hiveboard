import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  resolvePathSafe,
  validateWorkspacePath,
} from '../src/workspace/path-safety'

let root: string
let outside: string

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'path-safety-root-'))
  outside = await mkdtemp(join(tmpdir(), 'path-safety-outside-'))

  // Create directories inside root
  await mkdir(join(root, 'workspaces', 'project'), { recursive: true })
  await writeFile(join(root, 'workspaces', 'project', 'file.txt'), 'ok')

  // Create a file outside root
  await writeFile(join(outside, 'secret.txt'), 'sensitive')

  // Symlink inside root pointing within root (safe)
  await symlink(
    join(root, 'workspaces', 'project'),
    join(root, 'workspaces', 'safe-link'),
  )

  // Symlink inside root pointing outside root (escape)
  await symlink(outside, join(root, 'workspaces', 'escape-link'))

  // Nested symlink: link-a -> link-b -> outside
  await mkdir(join(root, 'workspaces', 'nested'), { recursive: true })
  await symlink(outside, join(root, 'workspaces', 'nested', 'link-b'))
  await symlink(
    join(root, 'workspaces', 'nested', 'link-b'),
    join(root, 'workspaces', 'nested', 'link-a'),
  )
})

afterAll(async () => {
  await rm(root, { force: true, recursive: true })
  await rm(outside, { force: true, recursive: true })
})

describe('resolvePathSafe', () => {
  test('resolves a regular path', async () => {
    const result = await resolvePathSafe(join(root, 'workspaces', 'project'))
    expect(result).toBe(join(root, 'workspaces', 'project'))
  })

  test('resolves a symlink within root', async () => {
    const result = await resolvePathSafe(join(root, 'workspaces', 'safe-link'))
    expect(result).toBe(join(root, 'workspaces', 'project'))
  })

  test('resolves a symlink pointing outside root', async () => {
    const result = await resolvePathSafe(
      join(root, 'workspaces', 'escape-link'),
    )
    expect(result).toBe(outside)
  })

  test('resolves nested symlinks', async () => {
    const result = await resolvePathSafe(
      join(root, 'workspaces', 'nested', 'link-a'),
    )
    expect(result).toBe(outside)
  })

  test('handles ENOENT paths gracefully', async () => {
    const result = await resolvePathSafe(
      join(root, 'workspaces', 'nonexistent', 'deep', 'path'),
    )
    expect(result).toBe(join(root, 'workspaces', 'nonexistent', 'deep', 'path'))
  })

  test('throws on relative paths', async () => {
    expect(resolvePathSafe('relative/path')).rejects.toThrow(
      'Path must be absolute',
    )
  })
})

describe('validateWorkspacePath', () => {
  test('accepts a path inside root', async () => {
    await expect(
      validateWorkspacePath(join(root, 'workspaces', 'project'), root),
    ).resolves.toBeUndefined()
  })

  test('accepts a symlink that stays within root', async () => {
    await expect(
      validateWorkspacePath(join(root, 'workspaces', 'safe-link'), root),
    ).resolves.toBeUndefined()
  })

  test('rejects a symlink that escapes root', async () => {
    await expect(
      validateWorkspacePath(join(root, 'workspaces', 'escape-link'), root),
    ).rejects.toThrow('Workspace path escapes root')
  })

  test('rejects nested symlinks that escape root', async () => {
    await expect(
      validateWorkspacePath(join(root, 'workspaces', 'nested', 'link-a'), root),
    ).rejects.toThrow('Workspace path escapes root')
  })

  test('rejects path equal to root', async () => {
    await expect(validateWorkspacePath(root, root)).rejects.toThrow(
      'Workspace path cannot be the root',
    )
  })

  test('accepts ENOENT paths under root', async () => {
    await expect(
      validateWorkspacePath(
        join(root, 'workspaces', 'nonexistent', 'new-file'),
        root,
      ),
    ).resolves.toBeUndefined()
  })
})
