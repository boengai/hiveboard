export interface MarkdownPreviewProps {
  content: string
  className?: string
}

export interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  rows?: number
}
