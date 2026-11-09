import { useCallback, useEffect, useState } from 'react'
import { PORTAL_BASE, authHeaders } from 'racklist'
import { tr } from 'lilak-ui/i18n.jsx'
import FlowMap from './FlowMap.jsx'

/** One flow's tab: LILAK's graph of the macro its record points at. */
export default function FlowView({ flow }) {
  const [got, setGot] = useState(null)
  const root = flow?.root || 'lilak', path = flow?.path || ''
  const load = useCallback(() => {
    if (!path) return undefined
    let live = true
    setGot(null)
    fetch(`${PORTAL_BASE}/api/flow/graph?root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}`, { headers: authHeaders() })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}))
        if (live) setGot(r.ok ? { model: body } : { error: body.detail || r.status })
      })
      .catch((e) => live && setGot({ error: e.message }))
    return () => { live = false }
  }, [root, path])
  useEffect(() => load(), [load])

  if (!flow) return <div className="av-say">{tr('av_gone')}</div>
  return (
    <div className="av-view">
      <div className="av-bar">
        <span className="av-path" title={path}>{path}</span>
        <button type="button" className="rl-btn" onClick={load}>{tr('av_reload')}</button>
      </div>
      {!got && <div className="av-say">{tr('av_loading')}</div>}
      {got?.error && <div className="av-say bad">{tr('av_failed', got.error)}</div>}
      {got?.model && <div className="av-map"><FlowMap model={got.model} /></div>}
    </div>
  )
}
