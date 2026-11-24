import { useState } from 'react'
import { tr } from 'lilak-ui/i18n.jsx'

/** Another service's record (a logbook log, a parameters set this page made for a run), opened in an
 *  editor pane: that service's own editor for it (its ?solo= page, the way rack services open each
 *  other's records), locked until unlocked. */
export default function LogView({ svc, proj, id }) {
  const [locked, setLocked] = useState(true)
  if (!proj) return <div className="av-say bad">{tr('av_run_noset')}</div>
  return (
    <div className="av-view av-log">
      <div className="av-bar">
        <span className="av-path">{svc} · {proj}</span>
        <button type="button" className={`rl-btn${locked ? '' : ' on'}`} title={tr(locked ? 'av_log_unlock_hint' : 'av_log_lock_hint')}
          onClick={() => setLocked(!locked)}>{tr(locked ? 'av_unlock' : 'av_lock')}</button>
      </div>
      {/* A new src on unlock: the editor draws again, now changeable. */}
      <iframe key={locked ? 'l' : 'u'} className="av-log-frame" title={svc}
        src={`/pp/${svc}/${proj}/?solo=${encodeURIComponent(id)}${locked ? '&locked=1' : ''}`} />
    </div>
  )
}
