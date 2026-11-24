import { useMemo, useState } from 'react'
import { load, save } from 'racklist'
import { tr } from 'lilak-ui/i18n.jsx'
import Icon from 'lilak-ui/icons.jsx'
import { treeOf, allDirs } from './tree.js'
import { HIDDEN, rootOf } from './api.js'

// The directory tab: the same files as home, as their folders, each opened or folded by a
// click on its line. A click opens a file's editor; a right click also opens its flow board
// (a file with a run) as a tab of its own. Which folders are open is kept per browser. A search opens every folder
// that holds a match.
const KEY = 'lilak_flow.dirs.open'
const MODE = 'lilak_flow.dirs.mode'   // 'tree' (by folder) or 'files' (every file, the last changed first)

export default function DirView({ api }) {
  // LILAK's own and shared files stay out; another root's are under its name (scratch/…).
  const files = useMemo(() => (api.doc?.flows || []).filter((f) => !HIDDEN.has(f.project))
    .map((f) => (rootOf(f) === 'lilak' ? f : { ...f, path: `${rootOf(f)}/${f.path}` })), [api.doc?.flows])
  const q = String(api.query || '').trim().toLowerCase()
  const shown = useMemo(() => (q ? files.filter((f) => f.path.toLowerCase().includes(q)) : files), [files, q])
  const tree = useMemo(() => treeOf(shown), [shown])
  const [open, setOpen] = useState(() => new Set(load(KEY, [])))
  const keep = (s) => { setOpen(s); save(KEY, [...s]) }
  const flip = (p) => { const s = new Set(open); s.has(p) ? s.delete(p) : s.add(p); keep(s) }
  const isOpen = (p) => !!q || open.has(p)
  const [picked, setPicked] = useState('')
  const [mode, setModeNow] = useState(() => load(MODE, 'tree'))
  const setMode = (m) => { setModeNow(m); save(MODE, m) }
  const flat = useMemo(() => [...shown].sort((a, b) => String(b.updated).localeCompare(String(a.updated))), [shown])

  // The rack browsing tab's lines (racklist browse.jsx: rl-file, rl-browse-dir): a folder blue with its
  // folder icon, a file grey with its; how many under a folder, and a file's time, small on the right.
  const dir = (d, depth) => (
    <div key={d.path}>
      <button type="button" className="rl-file rl-browse-dir" style={{ paddingLeft: 11 + depth * 16 }}
        aria-expanded={isOpen(d.path)} onClick={() => flip(d.path)}>
        <span><Icon name={isOpen(d.path) ? 'caret-down' : 'caret-right'} size={11} /><Icon name="folder" size={15} /> {d.name}</span>
        <span className="rl-dim">{d.count}</span><span className="rl-dim rl-mono" />
      </button>
      {isOpen(d.path) && body(d, depth + 1)}
    </div>
  )
  const file = (f, depth, withPath = false) => (
    <button key={f.id} type="button" className={`rl-file rl-browse-f${picked === f.id ? ' on' : ''}`} style={{ paddingLeft: 11 + Math.max(depth, 0) * 16 + (depth >= 0 ? 11 : 0) }}
      onClick={() => { setPicked(f.id); api.openItem(f.id) }}
      onContextMenu={(e) => {
        e.preventDefault(); setPicked(f.id); api.openItem(f.id)
        if (f.flow) api.openTab({ id: `flow:${f.id}`, kind: 'view', view: 'flow', who: f.id, label: f.name })
      }}
      title={`${f.path}\n${tr('av_dirs_open_hint')}`}>
      <span><Icon name="file" size={15} /> {f.name}{f.flow ? <span className="av-file-run">{tr('av_has_run')}</span> : null}
        {withPath && <span className="av-file-path">{f.path.split('/').slice(0, -1).join('/')}/</span>}</span>
      <span className="rl-dim">{f.count}</span>
      <span className="rl-dim rl-mono">{f.updated}</span>
    </button>
  )
  const body = (d, depth) => (<>{d.dirs.map((c) => dir(c, depth))}{d.files.map((f) => file(f, depth))}</>)

  return (
    <div className="av-dirs rl-browse">
      <div className="av-dirs-bar">
        <span className="av-tag">{tr('av_dirs_count', shown.length)}</span>
        {/* By folder, or every file in one list (what the home tab was), the last changed first. */}
        <button type="button" className={`rl-btn${mode === 'tree' ? ' on' : ''}`} onClick={() => setMode('tree')}>{tr('av_dirs_tree')}</button>
        <button type="button" className={`rl-btn${mode === 'files' ? ' on' : ''}`} onClick={() => setMode('files')}>{tr('av_dirs_files')}</button>
        {mode === 'tree' && <>
          <button type="button" className="rl-btn" onClick={() => keep(new Set(allDirs(tree)))}>{tr('av_t_open_all')}</button>
          <button type="button" className="rl-btn" onClick={() => keep(new Set())}>{tr('av_t_shut_all')}</button>
        </>}
      </div>
      <div className="rl-files">{mode === 'files' ? flat.map((f) => file(f, -1, true)) : body(tree, 0)}</div>
      {!shown.length && <div className="av-say">{tr('av_dirs_none')}</div>}
    </div>
  )
}
