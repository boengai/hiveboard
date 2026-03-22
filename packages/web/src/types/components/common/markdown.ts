export type MarkdownPreviewProps = {
  content: string
}

export type MarkdownEditorProps = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  rows?: number
  onImageUpload?: (file: File) => Promise<string>
  uploading?: boolean
}
