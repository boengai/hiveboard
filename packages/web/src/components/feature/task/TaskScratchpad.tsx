import { useEffect, useState } from 'react'
import { MarkdownPreview } from '@/components/common'
import { SCRATCHPAD_UPDATED_SUBSCRIPTION } from '@/graphql'
import { useTaskSubscription } from '@/hooks'
import type { ScratchpadUpdatedPayload, TaskScratchpadProps } from '@/types'

export function TaskScratchpad({
  taskId,
  initialContent,
}: TaskScratchpadProps) {
  const [content, setContent] = useState(initialContent)

  useEffect(() => {
    setContent(initialContent)
  }, [initialContent])

  useTaskSubscription<ScratchpadUpdatedPayload>(
    SCRATCHPAD_UPDATED_SUBSCRIPTION,
    { taskId },
    (data) => {
      const payload = data.scratchpadUpdated
      if (!payload || payload.taskId !== taskId) return
      setContent(payload.content)
    },
  )

  if (!content) {
    return (
      <p className="py-2 text-body-xs text-text-tertiary">
        Agent hasn&apos;t written any notes yet.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-body-xs text-text-tertiary">
        Agent scratchpad — notes the agent keeps across runs on this task.
        Read-only.
      </p>
      <div className="rounded-lg border border-border-default bg-surface-overlay/30 p-3">
        <MarkdownPreview content={content} />
      </div>
    </div>
  )
}
