import { useCallback, useEffect, useState } from 'react'
import { tr } from 'lilak-ui/i18n.jsx'
import { loadGraph } from './api.js'
import FlowMap from './FlowMap.jsx'
import SendJob from './SendJob.jsx'

/** One file's flow board: LILAK's graph of it. */
export default function FlowView({ flow }) {
  const [got, setGot] = useState(null)
  const id = flow?.id
  const load = useCallback(() => {
    if (!id) return undefined
    let live = true
    setGot(null)
    loadGraph(id).then((model) => ({ model }))
      .then((d) => live && setGot(d))
      .catch((e) => live && setGot({ error: e.message }))
    return () => { live = false }
  }, [id])
  useEffect(() => load(), [load])
  // Saved in its editor: draw the file as it is now.
  useEffect(() => {
    const saved = (e) => { if (e.detail?.id === id) load() }
    window.addEventListener('lilak_flow:saved', saved)
    return () => window.removeEventListener('lilak_flow:saved', saved)
  }, [id, load])

  if (!flow) return <div className="av-say">{tr('av_gone')}</div>
  return (
    <div className="av-view">
      <div className="av-bar">
        <span className="av-path" title={flow.path}>{flow.path}</span>
        {flow.flow && <SendJob path={flow.path} />}
        <button type="button" className="rl-btn" onClick={load}>{tr('av_reload')}</button>
      </div>
      {!got && <div className="av-say">{tr('av_loading')}</div>}
      {got?.error && <div className="av-say bad">{tr('av_failed', got.error)}</div>}
      {got?.model && <div className="av-map"><FlowMap model={got.model} /></div>}
    </div>
  )
}
