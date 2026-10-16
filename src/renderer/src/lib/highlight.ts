/**
 * Find `needle` in the text under `root` and wrap it in <mark> elements.
 *
 * Matching ignores case, whitespace and punctuation, because the original
 * (PDF text runs, Word paragraphs) never splits text the same way our parser
 * does. We anchor on the first ~60 and last ~40 meaningful characters so a
 * small extraction difference in the middle doesn't lose the match.
 * Returns the first <mark>, or null if the clause can't be found, which is
 * itself useful: it means the captured text may not match the original.
 */
export function highlightText(root: HTMLElement, needle: string): HTMLElement | null {
  const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '')
  const target = norm(needle)
  if (target.length < 8) return null

  const nodes: Text[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text)

  // Normalised haystack plus a map from each kept character back to (node, offset).
  let hay = ''
  const map: { node: number; offset: number }[] = []
  nodes.forEach((node, ni) => {
    const text = node.data
    for (let i = 0; i < text.length; i++) {
      const c = norm(text[i])
      if (c) {
        hay += c
        map.push({ node: ni, offset: i })
      }
    }
  })

  const head = target.slice(0, 60)
  const tail = target.slice(-40)
  const start = hay.indexOf(head)
  if (start < 0) return null
  const tailAt = hay.indexOf(tail, start)
  const end =
    tailAt >= 0 && tailAt - start < target.length * 1.5 ? tailAt + tail.length : Math.min(hay.length, start + target.length)

  // Per text node, the slice [from, to) to highlight.
  const spans = new Map<number, { from: number; to: number }>()
  for (let k = start; k < end; k++) {
    const { node, offset } = map[k]
    const s = spans.get(node)
    if (s) s.to = offset + 1
    else spans.set(node, { from: offset, to: offset + 1 })
  }

  let first: HTMLElement | null = null
  for (const [ni, { from, to }] of spans) {
    const range = document.createRange()
    range.setStart(nodes[ni], from)
    range.setEnd(nodes[ni], to)
    const mark = document.createElement('mark')
    mark.className = 'orig-hl'
    range.surroundContents(mark)
    first ??= mark
  }
  return first
}

/** Allow-list sanitiser for Word-derived HTML: structure and text only, no attributes. */
export function sanitiseHtml(html: string): DocumentFragment {
  const allowed = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'STRONG', 'B', 'EM', 'I', 'U', 'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'BR', 'SPAN', 'SUP', 'SUB'])
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const out = document.createDocumentFragment()
  const copy = (src: Node, dest: Node) => {
    for (const child of Array.from(src.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) dest.appendChild(document.createTextNode(child.textContent ?? ''))
      else if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as Element
        if (allowed.has(el.tagName)) {
          const clean = document.createElement(el.tagName.toLowerCase())
          copy(el, clean)
          dest.appendChild(clean)
        } else copy(el, dest) // drop the tag, keep its text
      }
    }
  }
  copy(doc.body, out)
  return out
}
