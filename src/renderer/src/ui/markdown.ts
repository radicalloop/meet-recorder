// Minimal markdown subset for notes.md. The parser only ever produces plain-text
// tokens (never HTML), so rendering through React is injection-safe by construction.

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; children: Inline[] }
  | { kind: 'italic'; children: Inline[] }
  | { kind: 'code'; text: string }

export interface ListItem {
  /** null = plain bullet; boolean = checkbox state. */
  checked: boolean | null
  inlines: Inline[]
}

export type Block =
  | { kind: 'heading'; level: number; inlines: Inline[] }
  | { kind: 'paragraph'; inlines: Inline[] }
  | { kind: 'list'; ordered: boolean; items: ListItem[] }

const INLINE_RE =
  /`([^`]+)`|\*\*(.+?)\*\*|\*([^*\s][^*]*?)\*|_([^_\s][^_]*?)_|\[([^\]]*)\]\([^)]*\)/

export function parseInline(text: string): Inline[] {
  const out: Inline[] = []
  let rest = text
  while (rest.length > 0) {
    const m = INLINE_RE.exec(rest)
    if (!m) {
      out.push({ kind: 'text', text: rest })
      break
    }
    if (m.index > 0) out.push({ kind: 'text', text: rest.slice(0, m.index) })
    if (m[1] !== undefined) out.push({ kind: 'code', text: m[1] })
    else if (m[2] !== undefined) out.push({ kind: 'bold', children: parseInline(m[2]) })
    else if (m[3] !== undefined) out.push({ kind: 'italic', children: parseInline(m[3]) })
    else if (m[4] !== undefined) out.push({ kind: 'italic', children: parseInline(m[4]) })
    else if (m[5] !== undefined) out.push(...parseInline(m[5]))
    rest = rest.slice(m.index + m[0].length)
  }
  return out
}

export function parseMarkdown(md: string): Block[] {
  const blocks: Block[] = []
  let para: string[] = []
  let list: { ordered: boolean; items: ListItem[] } | null = null

  const flushPara = (): void => {
    if (para.length > 0) {
      blocks.push({ kind: 'paragraph', inlines: parseInline(para.join(' ')) })
      para = []
    }
  }
  const flushList = (): void => {
    if (list) {
      blocks.push({ kind: 'list', ordered: list.ordered, items: list.items })
      list = null
    }
  }

  for (const raw of md.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim()
    if (line === '') {
      flushPara()
      flushList()
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flushPara()
      flushList()
      blocks.push({ kind: 'heading', level: heading[1].length, inlines: parseInline(heading[2]) })
      continue
    }
    const bullet = /^[-*+]\s+(?:\[([ xX])\]\s+)?(.*)$/.exec(line)
    if (bullet) {
      flushPara()
      if (list?.ordered) flushList()
      list ??= { ordered: false, items: [] }
      list.items.push({
        checked: bullet[1] === undefined ? null : bullet[1] !== ' ',
        inlines: parseInline(bullet[2])
      })
      continue
    }
    const ordered = /^\d+[.)]\s+(.*)$/.exec(line)
    if (ordered) {
      flushPara()
      if (list && !list.ordered) flushList()
      list ??= { ordered: true, items: [] }
      list.items.push({ checked: null, inlines: parseInline(ordered[1]) })
      continue
    }
    flushList()
    para.push(line)
  }
  flushPara()
  flushList()
  return blocks
}

/** Plain text of an inline run, used in tests and for clipboard fallbacks. */
export function inlineText(inlines: Inline[]): string {
  return inlines
    .map((i) => (i.kind === 'text' || i.kind === 'code' ? i.text : inlineText(i.children)))
    .join('')
}
