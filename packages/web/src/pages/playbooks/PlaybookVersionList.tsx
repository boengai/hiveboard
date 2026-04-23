import type { PlaybookVersion } from '@/types'

type Props = {
  versions: PlaybookVersion[]
}

export function PlaybookVersionList({ versions }: Props) {
  if (versions.length === 0) {
    return (
      <p className="text-body-xs text-text-secondary">No versions yet.</p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {versions.map((v) => (
        <div
          key={v.id}
          className="rounded border border-border-default p-3 text-body-xs"
        >
          <div className="flex items-center justify-between">
            <div className="text-text-secondary">
              <strong className="text-text-primary">v{v.versionNumber}</strong>{' '}
              <span>
                by {v.createdBy.displayName} ·{' '}
                {new Date(v.createdAt).toLocaleString()}
              </span>
            </div>
          </div>
          <pre className="mt-2 whitespace-pre-wrap font-mono text-text-secondary">
            {v.promptTemplate}
          </pre>
        </div>
      ))}
    </div>
  )
}
