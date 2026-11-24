import { useCallback, useEffect, useState } from 'react'
import { tr } from 'lilak-ui/i18n.jsx'
import { loadInit } from './api.js'
import { envOf, useRunState } from './toolstate.js'

/** A file's parameters as LILAK holds them after Init: includes read, references, conditions and
 *  e{…} applied. A dry Init (no output, no log kept), with the board's e{…} values. Read only. */
export default function InitView({ id }) {
  const [got, setGot] = useState(null)
  const [q, setQ] = useState('')
  const rs = useRunState(id)
  const run = useCallback(() => {
    let live = true
    setGot(null)
    loadInit(id, envOf(id)).then((d) => live && setGot(Array.isArray(d?.pars) ? d : { error: tr('av_old_server') })).catch((e) => live && setGot({ error: e.message }))
    return () => { live = false }
  }, [id])
  useEffect(() => run(), [run])
  const env = Object.entries(envOf(id)).filter(([, v]) => v)
  const shown = (got?.pars || []).filter(([k, v]) => `${k} ${v}`.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <div className="av-view">
      <div className="av-bar">
        <span className="av-path" title={id}>{tr('av_init_of', id.split('/').pop())}{env.length ? ` · ${env.map(([k, v]) => `${k}=${v}`).join(' ')}` : ''}</span>
        <input className="av-init-q" value={q} placeholder={tr('av_init_find')} onChange={(e) => setQ(e.target.value)} />
        {/* Init done: what is next is a Run — the board's own button, pressed from here. */}
        <button type="button" className={`rl-btn${rs?.sure ? ' bad' : ' av-go'}`} disabled={!rs || rs.off} title={rs?.title || tr('av_run_open_board')}
          onClick={() => window.dispatchEvent(new CustomEvent('lilak_flow:press', { detail: { id } }))}>{rs?.label || 'Run'}</button>
      </div>
      {!got && <div className="av-say">{tr('av_init_running')}</div>}
      {got?.error && <div className="av-say bad">{tr('av_failed', got.error)}</div>}
      {got && !got.error && !got.pars?.length && <div className="av-say bad">{tr('av_init_none', got.returncode)}<pre className="av-init-tail">{got.tail}</pre></div>}
      {!!got?.pars?.length && (
        <div className="av-init">
          {shown.map(([k, v], i) => <div key={i} className="av-init-row"><span className="k">{k}</span><span className="v">{v}</span></div>)}
        </div>
      )}
    </div>
  )
}
