import * as Tabs from '@radix-ui/react-tabs'
import type { ReactNode } from 'react'
import { useState } from 'react'
import type { MarkdownEditorProps } from '@/types'
import { MarkdownPreview } from './MarkdownPreview'

const TabTrigger = ({
  value,
  children,
}: {
  value: string
  children: ReactNode
}) => (
  <Tabs.Trigger
    className="relative px-3 py-1.5 text-body-sm text-text-tertiary transition-colors after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full after:bg-honey-400 after:opacity-0 after:transition-opacity hover:text-text-secondary data-[state=active]:text-text-primary data-[state=active]:after:opacity-100"
    value={value}
  >
    {children}
  </Tabs.Trigger>
)

export const MarkdownEditor = ({
  value,
  onChange,
  placeholder = 'Write a description…',
  rows = 8,
}: MarkdownEditorProps) => {
  const [tab, setTab] = useState('write')

  return (
    <Tabs.Root className="flex flex-col" onValueChange={setTab} value={tab}>
      <Tabs.List className="flex gap-1 border-border-default border-b">
        <TabTrigger value="write">Write</TabTrigger>
        <TabTrigger value="preview">Preview</TabTrigger>
      </Tabs.List>

      <Tabs.Content className="pt-2" value="write">
        <textarea
          className="w-full resize-y rounded-md border border-border-default bg-surface-inset px-3 py-2 text-body-sm text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-honey-400 focus:shadow-glow-honey"
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          value={value}
        />
      </Tabs.Content>

      <Tabs.Content className="pt-2" value="preview">
        <div className="min-h-[250px] p-3">
          {value ? (
            <MarkdownPreview content={value} />
          ) : (
            <p className="text-body-sm text-text-tertiary">
              Nothing to preview
            </p>
          )}
        </div>
      </Tabs.Content>
    </Tabs.Root>
  )
}
