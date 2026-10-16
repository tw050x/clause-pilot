import { useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { SourceType } from '@shared/types'
import { highlightText, sanitiseHtml } from '../lib/highlight'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

/**
 * The original document with one clause highlighted, so the reviewer can check
 * the clause was captured correctly rather than trusting the parser.
 * PDF: rendered pages plus pdf.js's text layer (the highlight lives in it).
 * DOCX: the file rendered to HTML, sanitised. TXT: the raw file.
 */
export function OriginalView({ path, sourceType, highlight }: { path: string; sourceType: SourceType; highlight: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'loading' | 'found' | 'not-found' | 'error'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const host = ref.current!
    host.replaceChildren()
    setState('loading')
    ;(async () => {
      try {
        if (sourceType === 'pdf') await renderPdf(host, path, () => cancelled)
        else if (sourceType === 'docx') {
          const html = await window.api.file.docxHtml(path)
          const div = document.createElement('div')
          div.className = 'orig-docx'
          div.appendChild(sanitiseHtml(html))
          host.appendChild(div)
        } else {
          const bytes = await window.api.file.bytes(path)
          const pre = document.createElement('pre')
          pre.className = 'orig-txt'
          pre.textContent = new TextDecoder().decode(bytes)
          host.appendChild(pre)
        }
        if (cancelled) return
        const mark = highlightText(host, highlight)
        setState(mark ? 'found' : 'not-found')
        mark?.scrollIntoView({ block: 'center' })
      } catch (e) {
        if (!cancelled) {
          setError(String(e))
          setState('error')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [path, sourceType, highlight])

  return (
    <div className="orig">
      {state === 'loading' && <div className="orig-note">Loading original…</div>}
      {state === 'not-found' && (
        <div className="banner danger" style={{ margin: '0 0 12px' }}>
          This clause's text could not be found in the original. It may have been captured incorrectly (for example, merged with a neighbouring clause or split across a page). Check the original manually.
        </div>
      )}
      {state === 'error' && <div className="banner danger">{error}</div>}
      <div ref={ref} />
    </div>
  )
}

async function renderPdf(host: HTMLElement, path: string, cancelled: () => boolean) {
  const bytes = await window.api.file.bytes(path)
  const doc = await pdfjs.getDocument({ data: bytes }).promise
  const width = Math.min(host.clientWidth || 600, 900)
  const dpr = window.devicePixelRatio || 1
  for (let i = 1; i <= doc.numPages && !cancelled(); i++) {
    const page = await doc.getPage(i)
    const scale = width / page.getViewport({ scale: 1 }).width
    const vp = page.getViewport({ scale })
    const wrap = document.createElement('div')
    wrap.className = 'pdf-page'
    wrap.style.width = `${vp.width}px`
    wrap.style.height = `${vp.height}px`
    wrap.style.setProperty('--total-scale-factor', String(scale))
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(vp.width * dpr)
    canvas.height = Math.floor(vp.height * dpr)
    canvas.style.width = `${vp.width}px`
    canvas.style.height = `${vp.height}px`
    const text = document.createElement('div')
    text.className = 'textLayer'
    wrap.append(canvas, text)
    host.appendChild(wrap)
    await page.render({ canvas, viewport: page.getViewport({ scale: scale * dpr }) }).promise
    await new pdfjs.TextLayer({ textContentSource: await page.getTextContent(), container: text, viewport: vp }).render()
  }
}
