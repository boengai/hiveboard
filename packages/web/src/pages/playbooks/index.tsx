import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { ArrowIcon, Button } from '@/components'
import { usePlaybooks } from '@/hooks'
import type { PlaybookEditorState } from '@/types'
import { PlaybookEditor } from './PlaybookEditor'
import { PlaybookList } from './PlaybookList'

export function PlaybooksPage() {
  const { playbooks, loading, error, refresh } = usePlaybooks()
  const [editor, setEditor] = useState<PlaybookEditorState>({ mode: 'closed' })

  const closeEditor = () => setEditor({ mode: 'closed' })
  const handleSaved = () => {
    closeEditor()
    refresh()
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <div className="flex flex-col">
            <div className="flex items-center gap-1">
              <Link
                className="text-body-sm text-honey-400 hover:underline"
                to="/"
              >
                <ArrowIcon />
              </Link>
              <h1 className="font-semibold text-lg text-text-primary">
                Playbooks
              </h1>
            </div>
            <p className="text-body-sm text-text-secondary">
              Reusable, versioned task recipes. Dispatched on tasks as{' '}
              <code>playbook:&lt;name&gt;</code>.
            </p>
          </div>
        </div>
        <Button
          color="primary"
          onClick={() => setEditor({ mode: 'create' })}
          size="small"
          type="button"
        >
          New playbook
        </Button>
      </div>

      <section className="space-y-3">
        <h2 className="font-medium text-body-sm text-text-secondary">
          Available playbooks
        </h2>

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-body-sm text-red-700">
            {error.message}
          </div>
        ) : null}

        {loading ? (
          <p className="text-body-sm text-text-secondary">Loading...</p>
        ) : null}

        {!loading && !error ? (
          <PlaybookList
            onEdit={(pb) => setEditor({ mode: 'edit', playbook: pb })}
            onRefresh={refresh}
            playbooks={playbooks}
          />
        ) : null}
      </section>

      <PlaybookEditor
        onClose={closeEditor}
        onSaved={handleSaved}
        state={editor}
      />
    </div>
  )
}
