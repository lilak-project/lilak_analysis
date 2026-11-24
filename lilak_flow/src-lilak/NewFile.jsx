import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { tr } from 'lilak-ui/i18n.jsx'
import { knownPlaces, HIDDEN } from './api.js'

/** Where a new file goes: a project of LILAK's, a folder in it, a name. Chips, not a
 *  native menu (a closed <select> eats the next click inside the portal's frame). */
function Form({ title, preset, withTemplate, onDone }) {
  // The experiments' projects; LILAK's own and its shared ones (common, examples) are not offered
  // (one a file being copied came from stays, so its copy can go beside it).
  const places = new Map(knownPlaces())
  const projects = [...places.keys()].filter((p) => !HIDDEN.has(p) || p === preset?.project).sort((a, b) => (b === 'scratch') - (a === 'scratch') || a.localeCompare(b))
  const [project, setProject] = useState(preset?.project || projects[0] || '')
  const [folder, setFolder] = useState(preset?.folder || 'macros')
  const [name, setName] = useState(preset?.name || '')
  const [template, setTemplate] = useState(true)
  const ok = project && folder.trim() && name.trim()
  const done = (v) => (e) => { e?.preventDefault(); onDone(v) }
  return (
    <div className="av-veil" onMouseDown={(e) => e.target === e.currentTarget && onDone(null)}>
      <form className="av-dialog" onSubmit={done(ok ? { root: project === 'scratch' ? 'scratch' : 'lilak', project, folder: folder.trim(), name: name.trim(), template: withTemplate && template } : null)}>
        <div className="av-row av-head"><span className="av-title">{title}</span></div>
        <label className="av-drow"><span>{tr('av_f_project')}</span>
          <span className="av-chips">{projects.map((p) => (
            <button key={p} type="button" className={`rl-btn${p === project ? ' on' : ''}`} onClick={() => setProject(p)}>{p}</button>
          ))}</span>
        </label>
        <label className="av-drow"><span>{tr('av_f_folder')}</span>
          {/* A list of a fixed height (it scrolls), so another project does not resize the dialog. */}
          <span className="av-flist">
            <input className="rl-in" value={folder} onChange={(e) => setFolder(e.target.value)} />
            <span className="av-flist-in">{[...(places.get(project) || [])].sort().map((f) => (
              <button key={f} type="button" className={`av-fitem${f === folder ? ' on' : ''}`} onClick={() => setFolder(f)}>{f}</button>
            ))}</span>
          </span>
        </label>
        <label className="av-drow"><span>{tr('av_f_name')}</span>
          <span className="av-chips"><input className="rl-in" style={{ width: 240 }} autoFocus value={name}
            onChange={(e) => setName(e.target.value)} /><span className="av-sub">.mac</span></span>
        </label>
        {withTemplate && (
          <label className="av-drow"><span>{tr('av_new_start')}</span>
            <span className="av-chips">
              <button type="button" className={`rl-btn${template ? ' on' : ''}`} onClick={() => setTemplate(true)}>{tr('av_new_template')}</button>
              <button type="button" className={`rl-btn${template ? '' : ' on'}`} onClick={() => setTemplate(false)}>{tr('av_new_blank')}</button>
            </span>
          </label>
        )}
        <div className="av-drow av-dfoot">
          <button type="button" className="rl-btn" onClick={done(null)}>{tr('av_cancel')}</button>
          <button type="submit" className="rl-btn rl-go" disabled={!ok}>{tr('av_make')}</button>
        </div>
      </form>
    </div>
  )
}

/** Ask where a new file goes. Resolves { project, folder, name, template } or null (cancelled). */
export function askNewFile(opts) {
  return new Promise((resolve) => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    root.render(<Form {...opts} onDone={(v) => { root.unmount(); host.remove(); resolve(v) }} />)
  })
}
