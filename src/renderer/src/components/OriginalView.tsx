import { useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { renderAsync } from 'docx-preview'
import type { SourceType } from '@shared/types'
import { highlightText } from '../lib/highlight'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

/** Wait for the right column to finish widening before measuring it. */
const SETTLE_MS = 340
/** Never blow the pages up past this. */
const MAX_ZOOM = 1.35

/**
 * The original document with one clause highlighted, so the reviewer can check
 * the clause was captured correctly rather than trusting the parser.
 * PDF: the real pages plus pdf.js's text layer. Word: the document laid out as
 * pages (docx-preview), not a reformatted text view. Text: the raw file.
 * The pages are scaled to fit the (widened) column, then kept fitted on resize.
 */
export function OriginalView({ path, sourceType, highlight, label }: { path: string; sourceType: SourceType; highlight: string; label: string }) {
  const viewport = useRef<HTMLDivElement>(null)
  const pages = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'loading' | 'found' | 'not-found' | 'error'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const host = pages.current!
    host.replaceChildren()
    host.style.zoom = ''
    setState('loading')
    let naturalWidth = 0
    const fit = () => {
      const avail = (viewport.current?.clientWidth ?? 800) - 48
      if (naturalWidth) host.style.zoom = String(Math.min(MAX_ZOOM, avail / naturalWidth))
    }
    const ro = new ResizeObserver(fit)
    const timer = window.setTimeout(async () => {
      try {
        if (sourceType === 'pdf') naturalWidth = await renderPdf(host, path, () => cancelled)
        else if (sourceType === 'docx') naturalWidth = await renderDocx(host, path)
        else {
          const pre = document.createElement('pre')
          pre.className = 'orig-txt'
          pre.textContent = new TextDecoder().decode(await window.api.file.bytes(path))
          host.appendChild(pre)
          naturalWidth = 760
        }
        if (cancelled) return
        fit()
        ro.observe(viewport.current!)
        const mark = highlightText(host, highlight)
        setState(mark ? 'found' : 'not-found')
        mark?.scrollIntoView({ block: 'center' })
      } catch (e) {
        if (!cancelled) {
          setError(String(e))
          setState('error')
        }
      }
    }, SETTLE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      ro.disconnect()
    }
  }, [path, sourceType, highlight])

  return (
    <div className="orig" ref={viewport}>
      <div className="orig-head">
        <strong>Original document</strong>
        <span className="faint"> · {label} highlighted</span>
      </div>
      {state === 'loading' && <div className="orig-note">Loading the original…</div>}
      {state === 'not-found' && (
        <div className="banner danger" style={{ margin: '0 0 12px' }}>
          This clause’s text could not be found in the original. It may have been captured incorrectly (for example, merged with a neighbouring clause or split across a page). Check the original manually.
        </div>
      )}
      {state === 'error' && <div className="banner danger">{error}</div>}
      <div className="orig-pages" ref={pages} />
    </div>
  )
}

/** Renders every page at 1:1 (CSS px) and returns the page width; scaling is done with zoom. */
async function renderPdf(host: HTMLElement, path: string, cancelled: () => boolean): Promise<number> {
  const doc = await pdfjs.getDocument({ data: await window.api.file.bytes(path) }).promise
  const dpr = (window.devicePixelRatio || 1) * MAX_ZOOM // sharp at the largest zoom we use
  let width = 0
  for (let i = 1; i <= doc.numPages && !cancelled(); i++) {
    const page = await doc.getPage(i)
    const vp = page.getViewport({ scale: 96 / 72 }) // PDF points to CSS pixels
    width = Math.max(width, vp.width)
    const wrap = document.createElement('div')
    wrap.className = 'pdf-page'
    wrap.style.width = `${vp.width}px`
    wrap.style.height = `${vp.height}px`
    wrap.style.setProperty('--total-scale-factor', String(96 / 72))
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(vp.width * dpr)
    canvas.height = Math.floor(vp.height * dpr)
    canvas.style.width = `${vp.width}px`
    canvas.style.height = `${vp.height}px`
    const text = document.createElement('div')
    text.className = 'textLayer'
    wrap.append(canvas, text)
    host.appendChild(wrap)
    await page.render({ canvas, viewport: page.getViewport({ scale: (96 / 72) * dpr }) }).promise
    await new pdfjs.TextLayer({ textContentSource: await page.getTextContent(), container: text, viewport: vp }).render()
  }
  return width
}

/** Word laid out as pages. Contract files are untrusted: no scripts run (CSP), links can't navigate the app. */
async function renderDocx(host: HTMLElement, path: string): Promise<number> {
  const bytes = await window.api.file.bytes(path)
  await renderAsync(bytes, host, undefined, {
    inWrapper: true,
    breakPages: true,
    ignoreLastRenderedPageBreak: false,
    renderHeaders: true,
    renderFooters: true,
    renderComments: false,
    renderChanges: true, // show their redline as tracked insertions and deletions
    className: 'docx'
  })
  host.querySelectorAll('a').forEach((a) => a.removeAttribute('href'))
  const page = host.querySelector<HTMLElement>('section.docx')
  return page?.offsetWidth || 794
}
