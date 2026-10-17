import type { ReactNode } from 'react'

/**
 * Markdown from the AI, rendered as React elements (never as HTML, so nothing in a model's
 * answer can inject markup). Covers what answers use: headings, paragraphs, bullet and numbered
 * lists, quotes, code blocks, and **bold**, *italic* and `code` inline.
 */
export function Markdown({ text }: { text: string }) {
  return <div className="md">{blocks(text)}</div>
}

function blocks(text: string): ReactNode[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const out: ReactNode[] = []
  let i = 0
  const key = () => out.length
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    // ```code```
    if (/^```/.test(line)) {
      const body: string[] = []
      i++
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++])
      i++
      out.push(<pre key={key()}>{body.join('\n')}</pre>)
      continue
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      const level = Math.min(h[1].length + 2, 6)
      const Tag = `h${level}` as 'h3' | 'h4' | 'h5' | 'h6'
      out.push(<Tag key={key()}>{inline(h[2])}</Tag>)
      i++
      continue
    }
    if (/^>\s?/.test(line)) {
      const body: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ''))
      out.push(<blockquote key={key()}>{blocks(body.join('\n'))}</blockquote>)
      continue
    }
    if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line)
      const items: string[] = []
      while (i < lines.length && (ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/).test(lines[i])) {
        let item = lines[i++].replace(ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/, '')
        // Continuation lines (indented, not a new item) belong to the item.
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) item += ' ' + lines[i++].trim()
        items.push(item)
      }
      const List = ordered ? 'ol' : 'ul'
      out.push(
        <List key={key()}>
          {items.map((x, n) => (
            <li key={n}>{inline(x)}</li>
          ))}
        </List>
      )
      continue
    }
    // A paragraph: lines up to a blank line or another block.
    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|>|```|\s*[-*+]\s+|\s*\d+[.)]\s+)/.test(lines[i])) para.push(lines[i++])
    out.push(<p key={key()}>{inline(para.join(' '))}</p>)
  }
  return out
}

/** **bold**, *italic* / _italic_, `code`. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g
  let last = 0
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index))
    const t = m[0]
    if (t.startsWith('**')) out.push(<strong key={out.length}>{t.slice(2, -2)}</strong>)
    else if (t.startsWith('`')) out.push(<code key={out.length}>{t.slice(1, -1)}</code>)
    else out.push(<em key={out.length}>{t.slice(1, -1)}</em>)
    last = m.index! + t.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}
