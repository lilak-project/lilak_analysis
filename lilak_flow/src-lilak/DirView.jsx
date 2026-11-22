import { useMemo, useState } from 'react'
import { load, save } from 'racklist'
import { tr } from 'lilak-ui/i18n.jsx'
import { treeOf, allDirs } from './tree.js'

// The directory tab: the same files as home, as their folders, each opened or folded by a
// click on its line. Which folders are open is kept per browser. A search opens every folder
// that holds a match.
const KEY = 'lilak_flow.dirs.open'

export default function DirView({ api }) {
  const files = api.doc?.flows || []
  const q = String(api.query || '').trim().toLowerCase()
  const shown = useMemo(() => (q ? files.filter((f) => f.path.toLowerCase().includes(q)) : files), [files, q])
  const tree = useMemo(() => treeOf(shown), [shown])
  const [open, setOpen] = useState(() => new Set(load(KEY, [])))
  const keep = (s) => { setOpen(s); save(KEY, [...s]) }
  const flip = (p) => { const s = new Set(open); s.has(p) ? s.delete(p) : s.add(p); keep(s) }
  const isOpen = (p) => !!q || open.has(p)

  const dir = (d, depth) => (
    <div key={d.path}>
      <div className={`av-dir${isOpen(d.path) ? ' open' : ''}`} style={{ paddingLeft: 8 + depth * 16 }} role="button"
        aria-expanded={isOpen(d.path)} onClick={() => flip(d.path)}>
        <span className="av-dir-mark">{isOpen(d.path) ? '▾' : '▸'}</span>
        <span className="av-dir-name">{d.name}/</span>
        <span className="av-tag">{d.count}</span>
      </div>
      {isOpen(d.path) && body(d, depth + 1)}
    </div>
  )
  const file = (f, depth) => (
    <div key={f.id} className="av-file" style={{ paddingLeft: 8 + depth * 16 + 14 }} role="button" onClick={() => api.openItem(f.id)}
      title={f.path}>
      <span className="av-file-name">{f.name}</span>
      {f.flow ? <span className="av-file-run">{tr('av_has_run')}</span> : null}
      <span className="av-file-n">{f.count}</span>
      <span className="av-file-day">{f.updated}</span>
    </div>
  )
  const body = (d, depth) => (<>{d.dirs.map((c) => dir(c, depth))}{d.files.map((f) => file(f, depth))}</>)

  return (
    <div className="av-dirs">
      <div className="av-dirs-bar">
        <span className="av-tag">{tr('av_dirs_count', shown.length)}</span>
        <button type="button" className="rl-btn" onClick={() => keep(new Set(allDirs(tree)))}>{tr('av_t_open_all')}</button>
        <button type="button" className="rl-btn" onClick={() => keep(new Set())}>{tr('av_t_shut_all')}</button>
      </div>
      {body(tree, 0)}
      {!shown.length && <div className="av-say">{tr('av_dirs_none')}</div>}
    </div>
  )
}
