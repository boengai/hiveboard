import { describe, expect, test } from 'bun:test'
import { isValidPathSegment } from '../src/routes/images'

describe('isValidPathSegment', () => {
  const valid = ['abc', 'board-1', 'task_2', 'ABC123', '01HXYZ']

  for (const seg of valid) {
    test(`accepts valid segment: ${seg}`, () => {
      expect(isValidPathSegment(seg)).toBe(true)
    })
  }

  const invalid = [
    { input: '..', reason: 'dot-dot traversal' },
    { input: '../etc', reason: 'relative path traversal' },
    { input: '../../etc', reason: 'double traversal' },
    { input: 'foo/bar', reason: 'contains slash' },
    { input: 'foo\\bar', reason: 'contains backslash' },
    { input: '', reason: 'empty string' },
    { input: '.hidden', reason: 'dot-prefixed' },
    { input: 'a b', reason: 'contains space' },
    { input: 'foo\0bar', reason: 'contains null byte' },
  ]

  for (const { input, reason } of invalid) {
    test(`rejects invalid segment (${reason}): "${input}"`, () => {
      expect(isValidPathSegment(input)).toBe(false)
    })
  }
})

describe('handleImageUpload path traversal', () => {
  const { handleImageUpload } = require('../src/routes/images')

  function makeFormData(fields: Record<string, string | Blob>) {
    const fd = new FormData()
    for (const [k, v] of Object.entries(fields)) {
      fd.append(k, v)
    }
    return fd
  }

  function makeFile() {
    return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'test.png', {
      type: 'image/png',
    })
  }

  test('rejects boardId with path traversal', async () => {
    const fd = makeFormData({
      boardId: '../../../etc',
      file: makeFile(),
      taskId: 'task1',
    })
    const res = await handleImageUpload(
      new Request('http://localhost/api/images/upload', {
        body: fd,
        method: 'POST',
      }),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Invalid boardId')
  })

  test('rejects taskId with path traversal', async () => {
    const fd = makeFormData({
      boardId: 'board1',
      file: makeFile(),
      taskId: '../../passwd',
    })
    const res = await handleImageUpload(
      new Request('http://localhost/api/images/upload', {
        body: fd,
        method: 'POST',
      }),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Invalid taskId')
  })

  test('rejects sessionId with path traversal', async () => {
    const fd = makeFormData({
      boardId: 'board1',
      file: makeFile(),
      sessionId: '../../../tmp',
    })
    const res = await handleImageUpload(
      new Request('http://localhost/api/images/upload', {
        body: fd,
        method: 'POST',
      }),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Invalid sessionId')
  })

  test('rejects sessionId with slash', async () => {
    const fd = makeFormData({
      boardId: 'board1',
      file: makeFile(),
      sessionId: 'foo/bar',
    })
    const res = await handleImageUpload(
      new Request('http://localhost/api/images/upload', {
        body: fd,
        method: 'POST',
      }),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Invalid sessionId')
  })

  test('accepts valid boardId and taskId', async () => {
    const fd = makeFormData({
      boardId: 'board-1',
      file: makeFile(),
      taskId: 'task_2',
    })
    const res = await handleImageUpload(
      new Request('http://localhost/api/images/upload', {
        body: fd,
        method: 'POST',
      }),
    )
    expect(res.status).toBe(200)
  })

  test('accepts valid boardId and sessionId', async () => {
    const fd = makeFormData({
      boardId: 'board-1',
      file: makeFile(),
      sessionId: 'sess123',
    })
    const res = await handleImageUpload(
      new Request('http://localhost/api/images/upload', {
        body: fd,
        method: 'POST',
      }),
    )
    expect(res.status).toBe(200)
  })
})
