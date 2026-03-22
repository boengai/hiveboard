import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { generateId } from '../db'
import { resolvePathSafe } from '../workspace/path-safety'
import { getUploadDir } from './uploadDir'

const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
])

const MIME_TO_EXT: Record<string, string> = {
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
}

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB

/** Handle POST /api/images/upload */
export async function handleImageUpload(req: Request): Promise<Response> {
  try {
    const formData = await req.formData()
    const file = formData.get('file')
    const boardId = formData.get('boardId') as string | null
    const taskId = formData.get('taskId') as string | null
    const sessionId = formData.get('sessionId') as string | null

    if (!file || !(file instanceof Blob)) {
      return Response.json({ error: 'No file provided' }, { status: 400 })
    }

    if (!boardId) {
      return Response.json({ error: 'boardId is required' }, { status: 400 })
    }

    if (!taskId && !sessionId) {
      return Response.json(
        { error: 'Either taskId or sessionId is required' },
        { status: 400 },
      )
    }

    // Validate MIME type
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return Response.json(
        { error: `Unsupported file type: ${file.type}` },
        { status: 400 },
      )
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return Response.json(
        { error: `File too large. Maximum size is 5MB.` },
        { status: 413 },
      )
    }

    const root = getUploadDir()
    const id = generateId()
    const ext =
      MIME_TO_EXT[file.type] ?? (extname((file as File).name || '') || '.bin')
    const filename = `${id}${ext}`

    let dir: string
    let urlPath: string

    if (taskId) {
      dir = join(root, boardId, taskId)
      urlPath = `/api/images/${boardId}/${taskId}/${filename}`
    } else {
      dir = join(root, 'tmp', sessionId ?? '')
      urlPath = `/api/images/tmp/${sessionId}/${filename}`
    }

    await mkdir(dir, { recursive: true })
    const filePath = join(dir, filename)

    // Validate path safety
    await resolvePathSafe(filePath)

    const buffer = await file.arrayBuffer()
    await Bun.write(filePath, buffer)

    const originalName = (file as File).name || filename

    return Response.json({ filename: originalName, url: urlPath })
  } catch (err) {
    console.error('Image upload error:', err)
    return Response.json({ error: 'Upload failed' }, { status: 500 })
  }
}

/**
 * Delete uploaded images for a task that are not referenced in the body.
 * Compares filenames on disk against /api/images/ URLs found in the markdown.
 */
export async function cleanupUnusedImages(
  boardId: string,
  taskId: string,
  body: string,
): Promise<number> {
  const root = getUploadDir()
  const dir = join(root, boardId, taskId)

  let files: string[]
  try {
    const info = await stat(dir).catch(() => null)
    if (!info?.isDirectory()) return 0
    files = await readdir(dir)
  } catch {
    return 0
  }

  let removed = 0
  for (const file of files) {
    // Check if the file is referenced anywhere in the body
    if (!body.includes(file)) {
      await rm(join(dir, file), { force: true })
      removed++
    }
  }

  // Remove empty directory
  if (removed > 0) {
    const remaining = await readdir(dir).catch(() => [])
    if (remaining.length === 0) {
      await rm(dir, { force: true, recursive: true })
    }
  }

  return removed
}

/** Handle GET /api/images/** */
export async function handleImageServe(pathname: string): Promise<Response> {
  try {
    const root = getUploadDir()

    // Strip /api/images/ prefix
    const relativePath = pathname.replace(/^\/api\/images\//, '')

    // Reject path traversal attempts
    if (relativePath.includes('..') || relativePath.includes('\0')) {
      return new Response('Forbidden', { status: 403 })
    }

    // Maps directly: /api/images/{...} → {UPLOAD_DIR}/{...}
    const filePath = join(root, relativePath)

    // Validate path is safe
    const canonicalPath = await resolvePathSafe(filePath)
    if (!canonicalPath.startsWith(root)) {
      return new Response('Forbidden', { status: 403 })
    }

    const file = Bun.file(canonicalPath)
    if (!(await file.exists())) {
      return new Response('Not found', { status: 404 })
    }

    return new Response(file, {
      headers: {
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Type': file.type || 'application/octet-stream',
      },
    })
  } catch (err) {
    console.error('Image serve error:', err)
    return new Response('Not found', { status: 404 })
  }
}
