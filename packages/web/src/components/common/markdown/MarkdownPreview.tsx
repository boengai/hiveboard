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
        'prose prose-invert prose-sm max-w-none',
        // headings
        'prose-headings:text-text-primary prose-headings:font-semibold',
        // body text
        'prose-p:text-text-secondary prose-p:text-body-sm',
        // links
        'prose-a:text-honey-400 prose-a:no-underline hover:prose-a:underline',
        // code
        'prose-code:rounded prose-code:bg-surface-inset prose-code:px-1.5 prose-code:py-0.5 prose-code:text-body-xs prose-code:text-text-secondary prose-code:before:content-none prose-code:after:content-none',
        'prose-pre:bg-surface-inset prose-pre:rounded-md prose-pre:border prose-pre:border-border-default',
        // lists
        'prose-li:text-text-secondary prose-li:text-body-sm prose-li:marker:text-text-tertiary',
        // blockquote
        'prose-blockquote:border-honey-400/40 prose-blockquote:text-text-tertiary',
        // table
        'prose-th:text-text-primary prose-td:text-text-secondary prose-tr:border-border-default',
        // hr
        'prose-hr:border-border-default',
        // strong
        'prose-strong:text-text-primary',
      ].join(' ')}
    >
      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {content}
      </Markdown>
    </div>
  )
}
