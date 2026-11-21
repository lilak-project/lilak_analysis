import { useState } from 'react'
import { load, save, openInService } from 'racklist'
import { tr } from 'lilak-ui/i18n.jsx'
import { submitJob } from './api.js'

const KEY = 'lilak_flow.job.project'

/** Init or run this file as a jobboard job. Pressing it is the approval: a person is at the screen. */
export default function SendJob({ path }) {
  const [project, setProject] = useState(() => load(KEY, ''))
  const [said, setSaid] = useState(null)
  const [busy, setBusy] = useState(false)
  const send = async (recipe) => {
    setBusy(true)
    setSaid(null)
    save(KEY, project)
    try {
      setSaid({ job: await submitJob(recipe, { macro: path }, project) })
    } catch (e) {
      setSaid({ error: e.message })
    }
    setBusy(false)
  }
  return (
    <>
      <input className="rl-in" style={{ width: 130 }} value={project} placeholder={tr('av_job_project')}
        title={tr('av_job_project_hint')} onChange={(e) => setProject(e.target.value)} />
      {['lilak-init', 'lilak-run'].map((r) => (
        <button key={r} type="button" className="rl-btn" disabled={busy || !project.trim()} title={tr('av_job_hint')}
          onClick={() => send(r)}>{tr(r === 'lilak-init' ? 'av_job_init' : 'av_job_run')}</button>
      ))}
      {said?.job && (
        <button type="button" className="rl-btn" onClick={() => openInService('jobboard', said.job.proj, said.job.id)}>
          {tr('av_job_sent', String(said.job.jobId).slice(-6))}
        </button>
      )}
      {said?.error && <span className="av-bad" title={said.error}>{said.error}</span>}
    </>
  )
}
