import { useState } from 'react'
import { Icon } from '../lib/icons'

/**
 * Import… and Export… for the library or the playbook. Files are JSON in the app's own format;
 * an import is merged by id (new entries added, changed ones updated, nothing removed).
 */
export function useTransfer(kind: 'library' | 'playbook' | 'questions', onImported: () => void) {
  const [notice, setNotice] = useState<{ tone: 'info' | 'error'; text: string } | null>(null)
  const noun = kind === 'library' ? ['clause', 'clauses'] : kind === 'playbook' ? ['position', 'positions'] : ['question', 'questions']
  const n = (k: number) => `${k} ${noun[k === 1 ? 0 : 1]}`

  const doImport = async () => {
    try {
      const r = await window.api.kb.import(kind)
      if (!r) return
      onImported()
      const parts = [r.added && `${n(r.added)} added`, r.updated && `${n(r.updated)} updated`, r.unchanged && `${r.unchanged} already up to date`].filter(Boolean)
      setNotice({ tone: 'info', text: `Imported: ${parts.join(', ') || 'the file was empty'}.` })
    } catch (e) {
      setNotice({ tone: 'error', text: String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
    }
  }
  const doExport = async () => {
    const path = await window.api.kb.export(kind)
    if (path) setNotice({ tone: 'info', text: `Exported to ${path}` })
  }

  const buttons = (
    <>
      <button className="btn" onClick={doImport} title={`Add or update ${noun[1]} from a JSON file`}>
        <Icon name="upload" /> Import…
      </button>
      <button className="btn" onClick={doExport} title={`Save every ${noun[0]} as a JSON file`}>
        Export…
      </button>
    </>
  )
  const banner = notice && (
    <div className={`banner ${notice.tone === 'error' ? 'danger' : 'info'}`} style={{ marginBottom: 14 }}>
      {notice.tone === 'info' && <Icon name="check" />} {notice.text}
      <div style={{ flex: 1 }} />
      <button className="icon-btn" onClick={() => setNotice(null)}>
        <Icon name="x" size={13} />
      </button>
    </div>
  )
  return { buttons, banner }
}
