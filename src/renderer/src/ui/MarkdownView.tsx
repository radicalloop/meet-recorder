import { useMemo } from 'react'
import type { JSX, ReactNode } from 'react'
import { parseMarkdown } from './markdown'
import type { Inline } from './markdown'

function renderInlines(inlines: Inline[]): ReactNode[] {
  return inlines.map((inline, i) => {
    switch (inline.kind) {
      case 'text':
        return inline.text
      case 'code':
        return <code key={i}>{inline.text}</code>
      case 'bold':
        return <strong key={i}>{renderInlines(inline.children)}</strong>
      case 'italic':
        return <em key={i}>{renderInlines(inline.children)}</em>
    }
  })
}

export function Markdown({ source }: { source: string }): JSX.Element {
  const blocks = useMemo(() => parseMarkdown(source), [source])
  return (
    <div className="md">
      {blocks.map((b, i) => {
        if (b.kind === 'heading') {
          const Tag = `h${Math.min(b.level, 4)}` as 'h1' | 'h2' | 'h3' | 'h4'
          return <Tag key={i}>{renderInlines(b.inlines)}</Tag>
        }
        if (b.kind === 'paragraph') return <p key={i}>{renderInlines(b.inlines)}</p>
        const ListTag = b.ordered ? 'ol' : 'ul'
        return (
          <ListTag key={i}>
            {b.items.map((item, j) => (
              <li key={j} className={item.checked === null ? undefined : 'md-task'}>
                {item.checked !== null && (
                  <input type="checkbox" checked={item.checked} readOnly tabIndex={-1} />
                )}
                <span>{renderInlines(item.inlines)}</span>
              </li>
            ))}
          </ListTag>
        )
      })}
    </div>
  )
}
