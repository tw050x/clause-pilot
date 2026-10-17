import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react'

/** A textarea that grows to fit its text, so pre-filled wording is readable without scrolling. */
export const AutoTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function AutoTextarea(props, outer) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useImperativeHandle(outer, () => ref.current!)
  const fit = () => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`
  }
  useLayoutEffect(fit, [props.value])
  useEffect(() => {
    // Re-fit when the column changes width (text rewraps).
    const ro = new ResizeObserver(fit)
    if (ref.current) ro.observe(ref.current.parentElement ?? ref.current)
    return () => ro.disconnect()
  }, [])
  return <textarea {...props} ref={ref} style={{ ...props.style, overflow: 'hidden' }} />
})
