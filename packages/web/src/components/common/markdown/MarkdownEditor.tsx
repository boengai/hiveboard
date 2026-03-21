import * as Tabs from '@radix-ui/react-tabs'
import type { ReactNode } from 'react'
import { useState } from 'react'
import type { MarkdownEditorProps } from '@/types/components/common/markdown'
import { MarkdownPreview } from './MarkdownPreview'

const TabTrigger = ({
  value,
  children,
}: {
  value: string
  children: ReactNode
}) => (
  <Tabs.Trigger
    value={value}
    className="relative px-3 py-1.5 text-body-sm text-text-tertiary transition-colors hover:text-text-secondary data-[state=active]:text-text-primary after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full after:bg-honey-400 after:opacity-0 after:transition-opacity data-[state=active]:after:opacity-100"
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
    <Tabs.Root value={tab} onValueChange={setTab} className="flex flex-col">
      <Tabs.List className="flex gap-1 border-b border-border-default">
        <TabTrigger value="write">Write</TabTrigger>
        <TabTrigger value="preview">Preview</TabTrigger>
      </Tabs.List>

      <Tabs.Content value="write" className="pt-2">
        <textarea
          className="w-full resize-y rounded-md border border-border-default bg-surface-inset px-3 py-2 text-body-sm text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-honey-400 focus:shadow-glow-honey"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
        />
      </Tabs.Content>

      <Tabs.Content value="preview" className="pt-2">
        <div className="min-h-[120px] rounded-md border border-border-default bg-surface-inset p-3">
          <MarkdownPreview content={value} />
        </div>
      </Tabs.Content>
    </Tabs.Root>
  )
}
