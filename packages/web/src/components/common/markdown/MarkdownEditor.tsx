import * as Tabs from '@radix-ui/react-tabs'
import type { ReactNode } from 'react'
import { useCallback, useRef, useState } from 'react'
import { ImageIcon, SpinnerIcon } from '@/components/common/icon'
import type { MarkdownEditorProps } from '@/types'
import { MarkdownPreview } from './MarkdownPreview'

const UPLOAD_PLACEHOLDER = '![Uploading...]()'

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

function insertTextAtCursor(
  textarea: HTMLTextAreaElement,
  text: string,
  currentValue: string,
): { newValue: string; cursorPos: number } {
  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const before = currentValue.slice(0, start)
  const after = currentValue.slice(end)
  const newValue = `${before}${text}${after}`
  return { cursorPos: start + text.length, newValue }
}

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/')
}

function getImageFiles(dataTransfer: DataTransfer): File[] {
  return Array.from(dataTransfer.files).filter(isImageFile)
}

export const MarkdownEditor = ({
  value,
  onChange,
  placeholder = 'Write a description…',
  rows = 8,
  onImageUpload,
  uploading,
}: MarkdownEditorProps) => {
  const [tab, setTab] = useState('write')
  const [isDragOver, setIsDragOver] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const valueRef = useRef(value)
  valueRef.current = value

  const handleUpload = useCallback(
    async (file: File) => {
      if (!onImageUpload || !textareaRef.current) return
      const textarea = textareaRef.current

      // Insert placeholder at cursor
      const { newValue } = insertTextAtCursor(
        textarea,
        UPLOAD_PLACEHOLDER,
        valueRef.current,
      )
      onChange(newValue)

      try {
        const markdown = await onImageUpload(file)
        // Replace placeholder with real markdown using latest value from ref
        onChange(valueRef.current.replace(UPLOAD_PLACEHOLDER, markdown))
      } catch {
        onChange(valueRef.current.replace(UPLOAD_PLACEHOLDER, ''))
      }
    },
    [onImageUpload, onChange],
  )

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (!onImageUpload || !e.clipboardData) return
      const images = getImageFiles(e.clipboardData)
      if (images.length === 0) return

      e.preventDefault()
      for (const file of images) {
        handleUpload(file)
      }
    },
    [onImageUpload, handleUpload],
  )

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!onImageUpload) return
      e.preventDefault()
      setIsDragOver(true)
    },
    [onImageUpload],
  )

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(false)
      if (!onImageUpload || !e.dataTransfer) return

      const images = getImageFiles(e.dataTransfer)
      for (const file of images) {
        handleUpload(file)
      }
    },
    [onImageUpload, handleUpload],
  )

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (!files) return
      for (const file of Array.from(files)) {
        if (isImageFile(file)) handleUpload(file)
      }
      // Reset input so same file can be re-selected
      e.target.value = ''
    },
    [handleUpload],
  )

  return (
    <Tabs.Root className="flex flex-col" onValueChange={setTab} value={tab}>
      <div className="flex items-center justify-between border-border-default border-b">
        <Tabs.List className="flex gap-1">
          <TabTrigger value="write">Write</TabTrigger>
          <TabTrigger value="preview">Preview</TabTrigger>
        </Tabs.List>

        {onImageUpload && (
          <div className="flex items-center gap-1 pr-1">
            {uploading && (
              <span className="text-text-tertiary">
                <SpinnerIcon size={14} />
              </span>
            )}
            <button
              className="rounded p-1 text-text-tertiary transition-colors hover:bg-surface-overlay hover:text-text-secondary"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              title="Upload image"
              type="button"
            >
              <ImageIcon size={16} />
            </button>
            <input
              accept="image/png,image/jpeg,image/gif,image/webp"
              className="hidden"
              multiple
              onChange={handleFileSelect}
              ref={fileInputRef}
              type="file"
            />
          </div>
        )}
      </div>

      <Tabs.Content className="pt-2" value="write">
        <textarea
          autoComplete="off"
          className={`w-full resize-y rounded-md border bg-surface-inset px-3 py-2 text-body-sm text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-honey-400 focus:shadow-glow-honey ${
            isDragOver
              ? 'border-honey-400 shadow-glow-honey'
              : 'border-border-default'
          }`}
          onChange={(e) => onChange(e.target.value)}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onPaste={handlePaste}
          placeholder={placeholder}
          ref={textareaRef}
          rows={rows}
          spellCheck={false}
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
