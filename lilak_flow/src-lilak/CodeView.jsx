import { useEffect, useState } from 'react'
import { tr } from 'lilak-ui/i18n.jsx'
import { loadCode } from './api.js'
import CodeArea, { langOfFile } from '@note/CodeArea.jsx'

/** One class's header or source, read only, in note's code editor. */
export default function CodeView({ cls, kind }) {
  const [got, setGot] = useState(null)
  useEffect(() => {
    let live = true
    setGot(null)
    loadCode(cls, kind).then((d) => live && setGot(d)).catch((e) => live && setGot({ error: e.message }))
    return () => { live = false }
  }, [cls, kind])
  if (!got) return <div className="av-say">{tr('av_loading')}</div>
  if (!got.error && typeof got.text !== 'string') got.error = tr('av_code_old_server')
  if (got.error) return <div className="av-say bad">{tr('av_failed', got.error)}</div>
  return (
    <div className="av-view">
      <div className="av-bar"><span className="av-path" title={got.path}>{got.path}</span></div>
      <div className="av-code"><CodeArea text={got.text} lang={langOfFile(got.path)} readOnly /></div>
    </div>
  )
}
