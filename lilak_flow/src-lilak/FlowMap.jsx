import { useEffect, useMemo, useRef, useState } from 'react'
import './flowmap.css'
import { tr } from 'lilak-ui/i18n.jsx'
import { flowLayout, portRows, classOf, subText, actsOf, actRows, slotOf, statOf, heightOf, fileTip, fileBad, fileOk } from './layout.js'
import { loadClasses } from './api.js'
import { bytes } from './FileInfo.jsx'

const KIND = {
  task: '#b91c1c', detector: '#0d9488', inbranch: '#15803d', outbranch: '#b45309', parambox: '#2563eb',
  passbranch: '#7c3aed',                 // made in this run and read again in it (RawData from mfm)
  include: '#2563eb', others: '#64748b', env: '#2563eb',
}
function PortRow({ left, right }) {
  return (
    <div className="av-row av-port">
      {left && <span className="av-pt">{left}<i className="av-dot l" /></span>}
      {right && <span className="av-pt out">{right}<i className="av-dot r" /></span>}
    </div>
  )
}
const kindOf = (role, data) => KIND[role === 'outbranch' && data.style === 'branch_pass' ? 'passbranch' : role]

/** The picked card's buttons, in its class row (layout's actsOf): its class's doc (doxygen, a new
 *  browser tab), header and source (a code pane), and what only it does. Removing asks twice.
 *  A narrow card shows the short names. */
function Acts({ node, act }) {
  const { role } = node.data, cls = classOf(role, node.data)
  const [sure, setSure] = useState(false)
  const b = (long, short) => <><span className="l">{long}</span><span className="s">{short}</span></>
  const btn = (k, label, fn, extra = '', off = false, title) => <button key={k} type="button" className={`rl-btn${extra}`} disabled={off} title={title} onClick={fn}>{label}</button>
  const make = {
    doc: () => <a key="doc" className="rl-btn" title={`${cls} doc`} href={`https://lilak-project.github.io/lilak_doxygen/class${cls}.html`} target="_blank" rel="noreferrer">{b('doc', 'doc')}</a>,
    h: () => btn('h', b('header', '.h'), () => act.code?.(cls, 'h')),
    cpp: () => btn('cpp', b('source', '.cpp'), () => act.code?.(cls, 'cpp')),
    add: () => btn('add', b(tr('av_act_add'), '+'), () => act.adding?.(true)),
    drop: () => btn('drop', sure === 'drop' ? b(tr('av_act_drop_sure'), '?') : b(tr('av_act_drop'), '✕'), () => (sure === 'drop' ? act.drop?.(cls) : setSure('drop')), sure === 'drop' ? ' bad' : ''),
    init: () => btn('init', b(tr('av_act_init'), 'Init'), () => act.init?.()),
    // An output already there: a first press asks (it is kept aside, then written anew).
    exec: () => btn('exec', sure === 'run' ? b(tr('av_over_sure'), '?') : b('Run', 'Run'), () => (act.exists && sure !== 'run' ? (setSure('run'), act.showOut?.()) : (setSure(false), act.exec?.('run'))),
      sure === 'run' ? ' bad' : ' av-go', !!act.stale || !!act.block, act.block ? tr(act.block) : act.stale ? tr('av_run_stale') : act.exists ? tr('av_over_hint') : undefined),
    open: () => btn('open', b(tr('av_act_open'), tr('av_act_open')), () => act.include?.(node.data.value)),
  }
  return actRows(role, node.data).map((row, i) => (
    <div key={i} className="av-row av-sub av-acts" onClick={(e) => e.stopPropagation()} onMouseLeave={() => setSure(false)}>
      {row.map((k) => make[k]())}
    </div>
  ))
}

/** The e{…} card's rows: a name and the value an Init here gives it (empty: this server's). */
function EnvRows({ data, act }) {
  return data.vars.map((v) => (
    <label key={v} className="av-row av-env" onClick={(e) => e.stopPropagation()}>
      <span className="av-env-k" title={v}>{v}</span>
      <input className="av-env-v" value={act.env?.[v] ?? ''} placeholder={data.env?.[v] || tr('av_env_unset')} title={data.env?.[v] || ''}
        onChange={(e) => act.setEnv?.(v, e.target.value)} />
    </label>
  ))
}

/** The run card's task search: type, then a class (Enter: the first). Those already added are left out. */
function TaskPick({ node, have, act }) {
  const [q, setQ] = useState('')
  const [all, setAll] = useState(null)
  useEffect(() => { loadClasses().then((d) => setAll(Array.isArray(d?.tasks) ? d : { error: tr('av_old_server') })).catch((e) => setAll({ error: e.message })) }, [])
  const list = all?.error ? [] : [...(all?.tasks || []).map((c) => [c, 'task']), ...(all?.detectors || []).map((c) => [c, 'detector'])]
    .filter(([c]) => !have.has(c) && c.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 12)
  const pick = (c) => { act.add?.(c); act.adding?.(false) }
  return (
    <div className="av-pick" style={{ left: node.position.x, top: node.position.y + node.h + 4, width: Math.max(node.w, 220) }}
      onClick={(e) => e.stopPropagation()}>
      <input autoFocus value={q} placeholder={tr('av_task_search')} onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') act.adding?.(false); if (e.key === 'Enter' && list[0]) pick(list[0][0]) }} />
      {!all && <div className="av-pick-say">{tr('av_loading')}</div>}
      {all?.error && <div className="av-pick-say bad">{all.error}</div>}
      {list.map(([c, k]) => <button key={c} type="button" onClick={() => pick(c)}>{c}<i>{k}</i></button>)}
      {all && !all.error && !list.length && <div className="av-pick-say">{tr('av_task_none')}</div>}
    </div>
  )
}

/** The run card's state row: its last Init or Run (RunLog's), how far it got, and whether the
 *  parameters changed since. */
function runStat(ran, stale) {
  const st = ran?.st, Mode = ran?.mode === 'init' ? 'Init' : 'Run'
  const ev = st?.events != null ? tr('av_stat_events', st.events, st.total) : ''
  if (!ran) return { text: tr('av_stat_none'), cls: 'dim' }
  if (!st?.done) return { text: [tr('av_stat_running', Mode), ev, st ? `${st.seconds} s` : ''].filter(Boolean).join(' · '), cls: 'run' }
  if (!st.ok) return { text: `${Mode} ${tr('av_run_failed')}`, cls: 'bad' }
  const done = ran.mode === 'init' ? ['Initialized', st.total ? tr('av_file_entries', st.total) : ''] : ['Run done', ev]
  return { text: [...done, stale ? tr('av_stat_stale') : ''].filter(Boolean).join(' · '), cls: stale ? 'dim' : 'ok' }
}

/** The output card's state row: the file made (when, how big), not yet, or no folder for it. */
function outStat(f) {
  const o = f?.output
  if (!o) return { text: '', cls: 'dim' }
  if (f.outdir && !f.outdir.exists) return { text: `✗ ${tr('av_dir_none')}`, cls: 'bad' }
  if (!o.exists) return { text: tr('av_out_none'), cls: 'dim' }
  const t = o.mtime ? new Date(o.mtime * 1000) : null
  const at = t ? `${t.getMonth() + 1}/${t.getDate()} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}` : ''
  return { text: tr('av_out_made', at, bytes(o.size)), cls: 'ok' }
}

/** One card: a head row, then a row each for the subtitle and the ports. */
function Card({ node, on, pick, act }) {
  const { data } = node
  const { role } = data
  return (
    <div className={`av-node${data.empty ? ' empty' : ''}${on ? ' on' : ''}${fileBad(role, data.files) ? ' bad' : ''}`}
      style={{ '--av-kind': kindOf(role, data), left: node.position.x, top: node.position.y, width: node.w }}
      onClick={(e) => { e.stopPropagation(); pick(node.id) }}>
      <div className="av-row av-head">
        <span className="av-title" title={data.label}>{data.label}</span>
      </div>
      {data.picked && actsOf(role, data).length ? <Acts node={node} act={act} />
        : subText(role, data) && <div className={`av-row av-sub${classOf(role, data) && role !== 'run' ? ' av-cls' : ''}${fileOk(role, data.files) ? ' av-good' : ''}`} title={fileTip(role, data.files) || subText(role, data)}>{subText(role, data)}</div>}
      {/* The rest of the card's slot stays as blank rows, so picking it does not change its size. */}
      {Array.from({ length: slotOf(role, data) - statOf(role) - (data.picked && actsOf(role, data).length ? actRows(role, data).length : subText(role, data) ? 1 : 0) }, (_, i) => <div key={`s${i}`} className="av-row av-sub" />)}
      {/* Last in the slot, so it stays put whether the card is picked or not. */}
      {statOf(role) > 0 && (({ text, cls }) => <div className={`av-row av-sub av-stat ${cls}`} title={text}>{text}</div>)(role === 'run' ? runStat(act.ran, act.stale) : outStat(data.files))}
      {role === 'env' && <EnvRows data={data} act={act} />}
      {portRows(role, data).map(([l, r], i) => <PortRow key={i} left={l} right={r} />)}
    </div>
  )
}

/** The flow as a table at its real size: it scrolls, it does not zoom. */
/** `act`: what the cards' buttons do — code, add, drop, init, include, env, setEnv (FlowView's). */
export default function FlowMap({ model, onPick, act = {}, scoped = false, picked = null }) {
  // Cards narrow to the pane's width (down to a floor, then it scrolls).
  const box = useRef(null)
  const [room, setRoom] = useState(0)
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setRoom(Math.floor(e.contentRect.width)))
    ro.observe(box.current)
    return () => ro.disconnect()
  }, [])
  // Click a card: only its lines stand out, each in its branch's colour. Click it again, or
  // the board, and all show.
  // Back in sight (the editor had spread over it): the card picked before is picked again.
  const [focus, setFocus] = useState(picked)
  const { nodes, edges, width, height } = useMemo(() => flowLayout(model, room, focus), [model, room, focus])
  const [adding, setAdding] = useState(false)
  // Another model: the picked card stays picked while it is still on the board (a quiet re-read after a run).
  useEffect(() => { setFocus((f) => (f && flowLayout(model, room, null).nodes.some((n) => n.id === f) ? f : null)); setAdding(false) }, [model])   // eslint-disable-line react-hooks/exhaustive-deps
  const acts = { ...act, adding: setAdding }
  const pickRef = useRef(onPick)
  // The editor's "show all" lets go of the card here too.
  const was = useRef(scoped)
  useEffect(() => {
    if (was.current && !scoped) setFocus((f) => (nodes.find((n) => n.id === f)?.data.role === 'parambox' ? f : null))
    was.current = scoped
  }, [scoped])   // eslint-disable-line react-hooks/exhaustive-deps
  pickRef.current = onPick
  const hit = (e) => !e.chain && !!focus && (e.source === focus || e.target === focus)
  const lit = new Set(focus ? [focus, ...edges.filter(hit).flatMap((e) => [e.source, e.target])] : [])
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]))
  // The picked card goes out too (its file's editor shows only that card's parameters).
  useEffect(() => { pickRef.current?.(nodes.find((n) => n.id === focus) || null) }, [focus, nodes])
  const colour = (e) => {
    const b = [byId[e.source], byId[e.target]].find((n) => n && /branch/.test(n.data.role))
    return b ? kindOf(b.data.role, b.data) : undefined
  }
  const cls = (e) => `${e.chain ? 'chain' : e.animated ? 'moving' : e.dashed ? 'dashed' : ''}${hit(e) ? ' on' : ''}`
  return (
    <div className="av-tbl" ref={box}>
      <div className={`av-tbl-in${focus ? ' focused' : ''}`} style={{ width, height }} onClick={() => { setFocus(null); setAdding(false) }}>
        {nodes.map((n) => <Card key={n.id} node={n} on={lit.has(n.id)} act={acts} pick={(id) => { setFocus(focus === id ? null : id); setAdding(false) }} />)}
        <svg className="av-lines" width={width} height={height}>
          {/* the lit lines last, so they lie on top */}
          {[...edges.filter((e) => !hit(e)), ...edges.filter(hit)].map((e) => <path key={e.id} d={e.d} className={cls(e)} style={hit(e) ? { stroke: colour(e) } : undefined} />)}
        </svg>
        {adding && byId.run && <TaskPick node={{ ...byId.run, h: heightOf(byId.run.data.role, byId.run.data) }} act={acts}
          have={new Set(nodes.filter((n) => n.data.kind === 'class').map((n) => n.data.class_name || n.data.label))} />}
      </div>
    </div>
  )
}
