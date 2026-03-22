import Markdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import type { MarkdownPreviewProps } from '@/types'

export const MarkdownPreview = ({ content }: MarkdownPreviewProps) => {
  if (!content) {
    return <p className="text-body-sm text-text-tertiary">No description</p>
  }

  return (
    <div
      className={[
        'prose prose-invert max-w-none',
        // headings
        'prose-headings:font-semibold prose-headings:text-text-primary',
        // body text
        'prose-p:text-body prose-p:leading-relaxed prose-p:text-text-secondary',
        // links
        'prose-a:text-honey-400 prose-a:no-underline hover:prose-a:underline',
        // code
        'prose-code:rounded prose-code:bg-surface-inset prose-code:px-1.5 prose-code:py-0.5 prose-code:text-body-sm prose-code:text-text-secondary prose-code:before:content-none prose-code:after:content-none',
        'prose-pre:rounded-md prose-pre:border prose-pre:border-border-default prose-pre:bg-surface-inset',
        // lists
        'prose-li:text-body prose-li:leading-relaxed prose-li:text-text-secondary prose-li:marker:text-text-tertiary',
        // blockquote
        'prose-blockquote:border-honey-400/40 prose-blockquote:text-text-tertiary',
        // table
        'prose-tr:border-border-default prose-td:text-text-secondary prose-th:text-text-primary',
        // hr
        'prose-hr:border-border-default',
        // strong
        'prose-strong:text-text-primary',
      ].join(' ')}
    >
      <Markdown rehypePlugins={[rehypeHighlight]} remarkPlugins={[remarkGfm]}>
        {content}
      </Markdown>
    </div>
  )
}
