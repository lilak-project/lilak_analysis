import { runBlock } from './layout.js'
import { useCallback, useEffect, useRef, useState } from 'react'
import { load, save } from 'racklist'
import { tr } from 'lilak-ui/i18n.jsx'
import { loadGraph, loadFile, saveFile, findInclude } from './api.js'
import FlowMap from './FlowMap.jsx'
import RunLog from './RunLog.jsx'
import RunPanel from './RunPanel.jsx'
import { setScope, useScope, isLocked, useEnv, setEnv, setInit, setStale, useStale } from './toolstate.js'
import { addTask, dropTask } from './rows.js'

// The groups a card stands for in its file's editor. Parameter Container (or no card): every row;
// a card with no parameters of its own (a branch, a file, an include): none.
const scopeOf = (n) => ({ ...scopeOfData(n), node: n?.id })
const scopeOfData = (n) => {
  const d = n?.data
  if (!d || d.role === 'parambox') return null
  if (d?.role === 'run') return { label: d.label, groups: ['lilak', 'LKRun', 'persistency'] }
  if (d?.role === 'others') return { label: d.label, groups: d.groups }
  if (d.role === 'inputfile' || d.role === 'outputfile') return { label: d.label, groups: [], file: { role: d.role, files: d.files || null } }
  if (d?.role === 'task' || d?.role === 'detector') return { label: d.label, groups: [d.class_name || d.label], cls: d.class_name || d.label }
  return { label: d.label, groups: [] }
}

/** One file's flow board: LILAK's graph of it. */
export default function FlowView({ flow, api }) {
  const [got, setGot] = useState(null)
  const id = flow?.id
  const scope = useScope(id)
  const load = useCallback((fresh = false, quiet = false) => {
    if (!id) return undefined
    let live = true
    if (!quiet) setGot(null)
    loadGraph(id, fresh, quiet).then((model) => { setInit(id, model.init); return { model } })
      .then((d) => live && setGot(d))
      .catch((e) => live && setGot({ error: e.message }))
    return () => { live = false }
  }, [id])
  useEffect(() => load(), [load])
  // A run here ended: the board's files as they are now (its output is there), without redrawing.
  useEffect(() => {
    const on = (e) => { if (e.detail?.id === id) load(false, true) }
    window.addEventListener('lilak_flow:ran', on)
    return () => window.removeEventListener('lilak_flow:ran', on)
  }, [id, load])
  // This board's file is the one being edited: its parameter editor stays, the others' leave
  // (each saving what it has first, as a closed editor does).
  const kit = useRef(api)
  kit.current = api
  useEffect(() => {
    const a = kit.current
    if (!id || !a?.panes) return
    // Opened only if it is not: the board coming back into sight (a browsing tab closed beside it)
    // does not take the pane from the tab in front (the guide).
    if (!a.panes.tabs.some((t) => t.kind === 'item' && t.who === id)) a.openItem?.(id)
    // Only other files' editors leave: a class's code, Init values and logbook logs stay.
    for (const t of a.panes.tabs) if (t.kind === 'item' && t.who !== id) a.panes.leave(t.id)
  }, [id])
  // Saved in its editor: draw the file as it is now.
  useEffect(() => {
    const saved = (e) => { if (e.detail?.id === id) { setStale(id, true); load(true) } }
    window.addEventListener('lilak_flow:saved', saved)
    return () => window.removeEventListener('lilak_flow:saved', saved)
  }, [id, load])

  // The picked card outlives the board going out of sight (the editor spread over it): not cleared here.

  // A card's edit of the file (a task added or taken out) goes to the file's open editor, which
  // saves it as it saves any edit (and the board redraws on that save). No editor open: straight to the file.
  const [said, setSaid] = useState('')
  useEffect(() => setSaid(''), [id])
  // The last Init or Run of this file (RunLog's), for the drawer under the board; a run opens it.
  const [ran, setRan] = useState(null)
  // Open or folded, kept for the next visit (one for every file).
  const [panel, setPanelNow] = useState(() => load('lilak_flow.runpanel', true))
  const setPanel = useCallback((v) => { setPanelNow(v); save('lilak_flow.runpanel', v) }, [])
  const onRun = useCallback((r) => { setRan(r); if (r && !r.st) setPanel(true) }, [setPanel])
  const editRows = async (fn) => {
    const detail = { id, fn, took: false, refused: '' }
    window.dispatchEvent(new CustomEvent('lilak_flow:edit', { detail }))
    if (detail.took) { setSaid(detail.refused); return detail.refused }
    if (isLocked(id)) { setSaid(tr('av_edit_locked')); return tr('av_edit_locked') }
    try {
      const f = await loadFile(id)
      const r = await saveFile(id, f.version, { rows: fn(f.rows) })
      if (r.conflict) { setSaid(tr('av_changed_under')); return tr('av_changed_under') }
      setSaid(''); setStale(id, true); load(true)
      return ''
    } catch (e) { setSaid(e.message); return e.message }
  }
  // A guide's Confirm: its change goes the way a card's does (through the open editor, or to the file).
  const editRef = useRef(editRows)
  editRef.current = editRows
  useEffect(() => {
    const on = (e) => { if (e.detail?.id === id) { e.detail.heard = true; editRef.current(e.detail.fn).then(e.detail.reply) } }
    window.addEventListener('lilak_flow:apply', on)
    return () => window.removeEventListener('lilak_flow:apply', on)
  }, [id])
  const env = useEnv(id)
  const act = {
    code: (cls, kind) => api?.openEdit?.({ id: `code:${cls}.${kind}`, kind: 'code', who: `${cls}.${kind}`, label: `${cls}.${kind === 'h' ? 'h' : 'cpp'}` }),
    add: (cls) => editRows((rows) => addTask(rows, cls)),
    drop: (cls) => editRows((rows) => dropTask(rows, cls)),
    init: () => api?.openEdit?.({ id: `init:${id}`, kind: 'init', who: id, label: `Init · ${flow.path.split('/').pop()}` }),
    include: async (value) => {
      const f = await findInclude(id, value)
      if (f.id) { setSaid(''); api?.openItem?.(f.id) } else setSaid(f.path ? tr('av_include_not_mac', f.path) : tr('av_include_missing', value))
    },
    // The top bar's Run (RunLog) does it, so its state and its logbook link stay in one place.
    stale: useStale(id),
    block: runBlock(got?.model?.files),
    exists: !!got?.model?.files?.output?.exists,
    // Run asked before it writes over the output: the editor shows that output beside, what it was made with against now.
    showOut: () => {
      setScope(id, { label: 'Output File', groups: [], file: { role: 'outputfile', files: got?.model?.files || null } })
      if (!api?.panes?.tabs?.some((t) => t.kind === 'item' && t.who === id)) api?.openItem?.(id)
    },
    ran,
    exec: (mode) => window.dispatchEvent(new CustomEvent('lilak_flow:exec', { detail: { id, mode } })),
    env,
    setEnv: (name, value) => setEnv(id, name, value),
  }

  if (!flow) return <div className="av-say">{tr('av_gone')}</div>
  return (
    <div className="av-view">
      <div className="av-bar">
        <span className="av-path" title={flow.path}>{flow.path}</span>
        {flow.flow && <RunLog id={id} path={flow.path} block={runBlock(got?.model?.files)} exists={!!got?.model?.files?.output?.exists} onAsk={() => act.showOut()} pars={got?.model?.init || []} out={got?.model?.files?.output?.path} onState={onRun}
          openInit={act.init}
          openRec={(r, label) => api?.openEdit?.({ id: `rec:${r.svc}:${r.id}`, kind: 'rec', who: `${r.svc}/${r.proj}/${r.id}`, label })}
          openLog={(log) => api?.openEdit?.({ id: `log:${log.id}`, kind: 'log', who: log.id, label: `logbook · ${log.title || ''}` })} />}
        <button type="button" className="rl-btn" onClick={() => load(true)}>{tr('av_reload')}</button>
      </div>
      {!got && <div className="av-say">{tr('av_loading')}</div>}
      {got?.error && <div className="av-say bad">{tr('av_failed', got.error)}</div>}
      {said && <div className="av-say bad">{said}</div>}
      {got?.model && <div className="av-map"><FlowMap model={got.model} picked={scope?.node} onPick={(n) => {
        setScope(id, n && scopeOfData(n) ? scopeOf(n) : null)
        // The file's editor closed: a picked card (Parameter Container: the whole file) opens it again.
        if (n && !api?.panes?.tabs?.some((t) => t.kind === 'item' && t.who === id)) api?.openItem?.(id)
      }} scoped={!!scope} act={act} /></div>}
      {flow.flow && <RunPanel run={ran} open={panel} setOpen={setPanel} />}
    </div>
  )
}
