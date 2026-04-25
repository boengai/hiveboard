import { useState } from 'react'
import { Button } from '@/components'
import type { PlaybookListProps } from '@/types'
import { cnMerge } from '@/utils'
import { PlaybookVersionList } from './PlaybookVersionList'

export function PlaybookList({ playbooks, onEdit }: PlaybookListProps) {
  const [expanded, setExpanded] = useState<string | null>(null)

  if (playbooks.length === 0) {
    return <p className="text-body-sm text-text-secondary">No playbooks yet.</p>
  }

  return (
    <div className="flex flex-col gap-3">
      {playbooks.map((pb) => {
        const open = expanded === pb.id
        return (
          <div
            className={cnMerge(
              'rounded-lg border border-border-default p-4',
              pb.archived ? 'opacity-50' : '',
            )}
            key={pb.id}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-body-sm text-text-primary">
                    {pb.displayName}
                  </h3>
                  <code className="text-body-xs text-text-secondary">
                    {pb.name}
                  </code>
                  <span className="rounded bg-surface-raised px-1.5 py-0.5 text-body-xs text-text-secondary">
                    v{pb.currentVersion.versionNumber}
                  </span>
                  {pb.archived ? (
                    <span className="text-body-xs text-honey-600">
                      archived
                    </span>
                  ) : null}
                </div>
                {pb.description ? (
                  <p className="text-body-sm text-text-secondary">
                    {pb.description}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  onClick={() => setExpanded(open ? null : pb.id)}
                  size="small"
                  type="button"
                  variant="ghost"
                >
                  {open ? 'Hide versions' : `Versions (${pb.versions.length})`}
                </Button>
                {onEdit ? (
                  <Button
                    color="primary"
                    onClick={() => onEdit(pb)}
                    size="small"
                    type="button"
                    variant="ghost"
                  >
                    Edit
                  </Button>
                ) : null}
              </div>
            </div>
            {open ? (
              <div className="mt-3">
                <PlaybookVersionList versions={pb.versions} />
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
