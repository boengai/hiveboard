import { useCallback, useState } from 'react'
import { resizeImage } from '@/utils/resizeImage'

const ALLOWED_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
])

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB

type UseImageUploadOptions = {
  boardId: string
  taskId?: string
  sessionId?: string
}

export function useImageUpload({
  boardId,
  taskId,
  sessionId,
}: UseImageUploadOptions) {
  const [uploading, setUploading] = useState(false)

  const uploadImage = useCallback(
    async (file: File): Promise<string> => {
      // Client-side validation
      if (!ALLOWED_TYPES.has(file.type)) {
        throw new Error(`Unsupported file type: ${file.type}`)
      }
      if (file.size > MAX_FILE_SIZE) {
        throw new Error('File too large. Maximum size is 5MB.')
      }

      setUploading(true)
      try {
        const resized = await resizeImage(file)

        const formData = new FormData()
        formData.append('file', resized, resized.name)
        formData.append('boardId', boardId)
        if (taskId) formData.append('taskId', taskId)
        if (sessionId) formData.append('sessionId', sessionId)

        const res = await fetch('/api/images/upload', {
          body: formData,
          method: 'POST',
        })

        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || `Upload failed (${res.status})`)
        }

        const { url, filename } = (await res.json()) as {
          url: string
          filename: string
        }

        return `![${filename}](${url})`
      } finally {
        setUploading(false)
      }
    },
    [boardId, taskId, sessionId],
  )

  return { uploadImage, uploading }
}
