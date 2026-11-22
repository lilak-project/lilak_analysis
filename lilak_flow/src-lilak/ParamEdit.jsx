import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { load, save as keep, RackToolbox } from 'racklist'
import { tr } from 'lilak-ui/i18n.jsx'
import { loadFile, saveFile, restoreFile, convert, newFile, findInclude } from './api.js'
import { askNewFile } from './NewFile.jsx'
import { TOOLS, VIEWS } from './tools.jsx'
import { useTool, setTool, useLocked } from './toolstate.js'
import * as hist from './history.js'
import {
  keyed, bare, insert, remove, move, toggle, fromFile, flip, edit, splitPath, condText, withConds, withPlain, copyOf, newPar, newComment, isOff,
  grouped, partsOf, valueOf, flagsOf, docOf,
} from './rows.js'

let clip = []   // copied rows, kept across the files open on this page
const VIEW_KEY = 'lilak_flow.par.view'

/**
 * One file's parameters, to edit, inside its record's editor: a line a row (comments
 * too), by group, value by value (rich), or the text as it is (raw). Saving goes
 * through LILAK's own writer, which re-spaces the file; the backend refuses a save
 * that would change what the file says, and keeps the old text.
 */
export default function ParamEdit({ flow, ctx, patch, fieldCtx }) {
  const id = flow?.id
  const [file, setFile] = useState(null)        // what is on disk: { version, backups }
  const [rows, setRows] = useState([])
  const [text, setText] = useState('')
  const [view, setView] = useState(() => (VIEWS.includes(load(VIEW_KEY, 'table')) ? load(VIEW_KEY, 'table') : 'table'))
  const locked = useLocked(id)         // view only: every edit below is refused
  const tool = useTool()               // the open tool's id, '' for shut (the button is in the editor's top bar)
  const root = useRef(null)
  const anchor = useRef(null)
  // The editor this pane sits in: the toolbox stands beside IT. Set as the pane is put on the
  // page, before the toolbox (a child, whose effects run first) measures it.
  const place = useCallback((el) => { root.current = el; anchor.current = el?.closest('.rl-edit') || el }, [])
  const [shut, setShut] = useState(new Set())   // groups folded in the group view
  const [picked, setPicked] = useState(new Set())
  const [asking, setAsking] = useState(new Set())   // rows given ? whose condition is not typed yet
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState('')      // '' | 'wait' (edited) | 'on' (writing) | 'done' | 'stop' (refused: no more tries until the next edit)
  const drafts = useRef(new Map())               // rich view: a value's boxes as typed, by row key
  const gen = useRef(0)                          // edits made: a save that ends after another edit leaves it unsaved
  const version = useRef('')                     // the version the next save names (the last save's)
  // The record's own fields as this tab found them, for the info tab's revert (the kit's own line is hidden).
  const opened = useRef(null)
  if (opened.current?.id !== id) opened.current = { id, tags: flow?.tags || [], note: flow?.note || '' }
  const [stale, setStale] = useState('')        // which of the two is behind the other: 'text' after a row edit, 'rows' after typing in raw
  const [said, setSaid] = useState('')
  const bar = useRef('')
  const shown = useRef('')
  useEffect(() => { if (ctx?.say && bar.current !== shown.current) { shown.current = bar.current; ctx.say(bar.current) } })
  useEffect(() => () => { if (ctx?.say && shown.current) ctx.say('') }, [])
  const raw = view === 'raw'

  const take = useCallback(async (f, note = '') => {
    setFile({ version: f.version, backups: f.backups }); version.current = f.version; setSaving('')
    setRows(keyed(fromFile(f.rows))); setText(f.text); setPicked(new Set()); setDirty(false); setStale(''); setSaid(note)
  }, [])
  const act = useCallback(async (fn, note) => {
    try { await take(await fn(), note); return true } catch (e) { setSaid(e.message); return false }
  }, [take])
  // The record of this tab (the file tool): the file as opened, then as saved, kept until the tab closes.
  const [, bump] = useState(0)
  useEffect(() => {
    if (!id) return undefined
    act(async () => { const f = await loadFile(id); hist.begin(id, f); return f })
    return () => hist.leave(id)
  }, [id, act])

  const edited = () => {
    if (locked) return
    gen.current += 1; setDirty(true); setSaving('wait'); setSaid('') }
  const change = (next, pick) => {
    if (locked) return
    setRows(next); setStale('text'); edited(); if (pick) setPicked(pick) }
  const body = () => (raw ? { text } : { rows: bare(rows) })
  // Saved as it is edited, the way the kit saves a record: a moment after the last change.
  // The rows on screen stay as they are (the file LILAK writes is re-spaced, and taking it
  // back would move the caret); only the version moves on.
  const save = async () => {
    const g = gen.current
    setSaving('on')
    try {
      const r = await saveFile(id, version.current, body())
      if (r.conflict) { setSaid(tr('av_changed_under')); setSaving('stop'); return }
      version.current = r.file.version
      hist.add(id, r.file); bump((n) => n + 1)
      setFile({ version: r.file.version, backups: r.file.backups })
      if (gen.current === g) { setDirty(false); setSaving('done') } else setSaving('wait')
      // The flow board of this file, if it is open, draws the saved one.
      window.dispatchEvent(new CustomEvent('lilak_flow:saved', { detail: { id } }))
    } catch (e) { setSaid(e.message); setSaving('stop') }
  }
  const saveNow = useRef(save)
  saveNow.current = save
  useEffect(() => {
    if (!dirty || saving !== 'wait') return undefined
    const t = setTimeout(() => saveNow.current(), 800)
    return () => clearTimeout(t)
  }, [rows, text, dirty, saving])
  // Closed with an edit not yet written: write it now.
  const unsaved = useRef(false)
  unsaved.current = dirty && saving !== 'stop'
  useEffect(() => () => { if (unsaved.current) saveNow.current() }, [])
  // Another view of the same unsaved edit. To and from raw the backend converts, and says so if it cannot.
  const show = async (next) => {
    if (next === view) return
    try {
      // Only what was edited is converted: an untouched file shows its own text, as it is on disk
      // (LILAK's writer cannot write some files back, and raw is where those are edited).
      if (raw && stale === 'rows') setRows(keyed(fromFile((await convert({ text })).rows)))
      else if (next === 'raw' && stale === 'text') setText((await convert({ rows: bare(rows) })).text)
      if (raw || next === 'raw') setStale('')
      setView(next); keep(VIEW_KEY, next); setSaid(''); setPicked(new Set())
    } catch (e) { setSaid(e.message) }
  }
  // A copy of what is on screen (saved or not) as a new file, then that file's editor.
  const copyTo = async (title, name) => {
    const where = await askNewFile({ title, preset: { project: flow.project, folder: flow.path.split('/').slice(flow.project === 'lilak' ? 0 : 1, -1).join('/'), name } })
    if (!where) return
    try {
      const made = await newFile({ ...where, ...body() })
      await ctx?.reload?.()
      ctx?.openItem?.(made.id)
    } catch (e) { setSaid(e.message) }
  }

  // The kit's button bar sticks to the top of the editor; the column names stick just under it.
  useEffect(() => {
    const bar = anchor.current?.querySelector(':scope > .rl-acts'), pane = root.current
    if (!bar || !pane) return undefined
    const o = new ResizeObserver(() => pane.style.setProperty('--av-top', `${bar.offsetHeight}px`))
    o.observe(bar); return () => o.disconnect()
  }, [file != null])

  // No room beside the editor (a full-width tab): the toolbox stands inside it, and the
  // editor gives up that much on its side rather than having its rows covered.
  const [push, setPush] = useState(0)
  useEffect(() => {
    const el = anchor.current
    if (!el) return undefined
    el.style.paddingLeft = push?.side === 'left' ? `${push.px}px` : ''
    el.style.paddingRight = push && push.side !== 'left' ? `${push.px}px` : ''
    return () => { el.style.paddingLeft = ''; el.style.paddingRight = '' }
  }, [push])

  if (!flow) return null
  if (!file) return <div className="av-say">{said || tr('av_loading')}</div>
  const some = picked.size > 0
  const pickAll = () => setPicked(picked.size === rows.length ? new Set() : new Set(rows.map((r) => r._k)))
  const pickOne = (k) => setPicked((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n })
  const pickMany = (ks) => setPicked((p) => {
    const n = new Set(p), all = ks.every((k) => n.has(k))
    ks.forEach((k) => (all ? n.delete(k) : n.add(k)))
    return n
  })
  // (declared before the toolbox's ctx above reads it)
  const lastGroup = [...rows].reverse().find((r) => picked.has(r._k) && r.kind === 'parameter')?.group || ''
  const box = {
    flow, patch, fieldCtx,
    locked,
    revert: () => patch({ tags: opened.current.tags, note: opened.current.note }),
    file: { backups: file.backups, reload: () => act(() => loadFile(id)),
      restore: () => act(() => restoreFile(id), tr('av_restored')), copyTo,
      history: hist.list(id),
      // Back to one of the records: put on screen as an edit of its own, saved like any other.
      back: (h) => {
        if (locked) return
        setRows(keyed(fromFile(h.rows))); setText(h.text); setStale(''); setPicked(new Set()); drafts.current.clear()
        edited(); setSaid(tr('av_back_to', hist.hhmm(h.at)))
      } },
    view: { now: view, show, groups: () => grouped(rows).map((g) => g.name), shut, setShut },
    rows: {
      raw, some: picked.size, clip: clip.length,
      addPar: () => add([newPar(lastGroup)]), addComment: () => add([newComment()]),
      off: () => change(toggle(rows, picked)), remove: () => change(remove(rows, picked), new Set()),
      move: (d) => change(move(rows, picked, d)),
      copy: () => { clip = copyOf(rows, picked); setSaid(tr('av_copied', clip.length)) },
      paste: () => add(clip),
    },
  }
  const add = (made) => { const next = insert(rows, picked, made); change(next, new Set(next.filter((r) => !rows.includes(r)).map((r) => r._k))) }
  // What the header row says at its end: the save, then how many lines (and how many picked).
  const state = [saving && tr(`av_saving_${saving}`), tr('av_rows', rows.length, picked.size)].filter(Boolean).join(' · ')
  // What the sheet has to say goes to the service's bottom bar, so nothing above the rows comes and goes.
  bar.current = [said, saving && tr(`av_saving_${saving}`)].filter(Boolean).join(' · ')
  const no = new Map(rows.map((r, i) => [r._k, i + 1]))
  const cell = (r, f, cls, title) => {
    const Box = f === 'value' || f === 'name' ? Wrap : f === 'comment' ? Clip : 'input'
    // A `<` line's value is a file: a mark inside the cell says whether it is there, and opens it.
    if (f === 'value' && String(r.unit || '').includes('<')) {
      return (
        <span className="av-vbox">
          <Wrap className={`av-in ${cls}${r[f] ? '' : ' blank'}`} value={r[f] || ''} spellCheck={false} readOnly={locked} title={title}
            onChange={(e) => change(edit(rows, r._k, { [f]: e.target.value }))} />
          <IncludeMark file={id} value={r[f] || ''} open={ctx?.openItem} />
        </span>
      )
    }
    return <Box className={`av-in ${cls}${r[f] ? '' : ' blank'}`} value={r[f] || ''} spellCheck={false} readOnly={locked} title={title ?? (f === 'comment' ? r[f] : undefined)}
      onChange={(e) => change(edit(rows, r._k, { [f]: e.target.value }))} />
  }
  // The group path in two cells: its `?…` conditions (LILAK's name conditions) and the plain group.
  // The condition cell keeps what is typed (a space before the next one) while it means the same.
  const condCell = (r) => {
    const typed = drafts.current.get(`c${r._k}`), now = condText(r.group)
    const shown = typed != null && condText(withConds(r.group, typed)) === now ? typed : now
    return <input className="av-in cond" value={shown} spellCheck={false} readOnly={locked} title={tr('av_cond_hint')} autoFocus={!now}
      placeholder={tr('av_cond_ph')}
      onChange={(e) => { drafts.current.set(`c${r._k}`, e.target.value); change(edit(rows, r._k, { group: withConds(r.group, e.target.value) })) }} />
  }
  const groupCell = (r) => (
    <input className={`av-in group${splitPath(r.group).plain ? '' : ' blank'}`} value={splitPath(r.group).plain} spellCheck={false} readOnly={locked}
      onChange={(e) => change(edit(rows, r._k, { group: withPlain(r.group, e.target.value) }))} />
  )
  // # (commented out) and the flag, each a square that switches on a click.
  const marks = (r) => (<>
    <button type="button" className={`av-sq${isOff(r) ? ' on' : ''}`} title={tr('av_m_off')} disabled={locked}
      onClick={() => change(toggle(rows, new Set([r._k])))}>#</button>
    <button type="button" className={`av-sq${r.unit ? ' on' : ''}`} disabled={locked} title={r.unit && r.unit !== '<' ? tr('av_m_other', flagsOf(r.unit)) : tr('av_m_inc')}
      onClick={() => change(edit(rows, r._k, flip(r)))}>{r.unit || '<'}</button>
    {/* ? : the line holds only under conditions — then a line below it says which. Off drops them. */}
    <button type="button" className={`av-sq${hasCond(r) ? ' on' : ''}`} title={tr('av_m_cond')} disabled={locked}
      onClick={() => {
        if (hasCond(r)) { drafts.current.delete(`c${r._k}`); change(edit(rows, r._k, { group: withConds(r.group, '') })); setAsking((a) => { const n = new Set(a); n.delete(r._k); return n }) }
        else setAsking((a) => new Set(a).add(r._k))
      }}>?</button>
  </>)
  const hasCond = (r) => r.kind === 'parameter' && (!!condText(r.group) || asking.has(r._k))
  const check = (ks) => {
    const n = ks.filter((k) => picked.has(k)).length
    return <input type="checkbox" checked={ks.length > 0 && n === ks.length} ref={(el) => { if (el) el.indeterminate = n > 0 && n < ks.length }}
      onChange={() => pickMany(ks)} />
  }
  const line = (r) => {
    const rich = view === 'rich' && r.kind === 'parameter'
    // As typed, empty boxes too: the value itself is the filled ones, and a box just added
    // with + is empty until it is typed in (the value would drop it, and the box with it).
    const typed = drafts.current.get(r._k)
    const filled = (ps) => valueOf(ps.map((p) => p.trim()).filter(Boolean))
    const parts = !rich ? [] : typed && filled(typed) === String(r.value || '').trim() ? typed : partsOf(r.value)
    const setParts = (ps) => { drafts.current.set(r._k, ps); change(edit(rows, r._k, { value: filled(ps) })) }
    return (
      <Fragment key={r._k}>
      <div className={`av-row av-prow${picked.has(r._k) ? ' on' : ''}${isOff(r) ? ' off' : ''}${rich ? ' rich' : ''}`}
        onClick={(e) => { if (!e.target.closest('input, textarea, button, a, .av-clip')) pickOne(r._k) }}>
        <input type="checkbox" checked={picked.has(r._k)} onChange={() => pickOne(r._k)} />
        <span className="av-no">{no.get(r._k)}</span>
        {r.kind === 'comment' ? (<><span className="av-hash">{r.enabled ? '##' : '#'}</span>{cell(r, 'comment', 'grow dim')}</>)
          : rich ? (<>
            {marks(r)}<span className="av-full">{r.group ? `${r.group}/` : ''}{r.name}</span>
            <span className="av-parts">
              {parts.map((p, i) => (
                <span key={i} className="av-part">
                  <Wrap className={`av-in value${p ? '' : ' blank'}`} value={p} readOnly={locked} spellCheck={false} autoFocus={p === '' && i === parts.length - 1}
                    onChange={(e) => setParts(parts.map((q, j) => (j === i ? e.target.value : q)))} />
                  {!locked && <button type="button" className="av-sq" title={tr('av_part_drop')} onClick={() => setParts(parts.filter((_, j) => j !== i))}>×</button>}
                </span>
              ))}
              {!locked && <button type="button" className="av-sq av-plus" title={tr('av_part_add')} onClick={() => setParts([...parts, ''])}>+</button>}
            </span>
            {cell(r, 'comment', 'grow dim')}
          </>) : (<>
            {marks(r)}{view !== 'group' && groupCell(r)}{cell(r, 'name', 'name')}{cell(r, 'value', 'value')}{cell(r, 'comment', 'grow dim')}
          </>)}
      </div>
        {hasCond(r) && (
          <div className={`av-row av-condrow${isOff(r) ? ' off' : ''}`}>
            <span className="av-cpad" /><span className="av-no" /><span className="av-sq av-hd" /><span className="av-sq av-hd" />
            <span className="av-sq av-hd av-cif">?</span>{condCell(r)}
          </div>
        )}
      </Fragment>
    )
  }

  return (
    <div className={`av-pane${locked ? ' locked' : ''}`} ref={place}>
      {!ctx?.say && said && <div className="av-say av-note">{said}</div>}
      {tool ? (
        <RackToolbox anchor={anchor} kit={TOOLS} at={TOOLS.find((t) => t.id === tool) || TOOLS[0]} ctx={box}
          onPick={setTool} onShut={() => setTool('')} onPush={setPush} title={flow.name} />
      ) : null}
      {raw ? (
        <><div className="av-row av-head av-cols"><span className="av-in grow">raw</span></div>
        <textarea className="av-raw" value={text} spellCheck={false} readOnly={locked} rows={Math.min(40, Math.max(12, text.split('\n').length + 1))}
          onChange={(e) => { setText(e.target.value); setStale('rows'); edited() }} /></>
      ) : (
        <div className="av-params">
          <div className="av-row av-head av-prow av-cols">
            {check(rows.map((r) => r._k))}
            <span className="av-no" />
            <span className="av-sq av-hd">#</span><span className="av-sq av-hd">&lt;</span><span className="av-sq av-hd">?</span>
            {view === 'rich' ? (<><span className="av-full">name</span><span className="av-parts">values</span><span className="av-in grow">comment</span></>)
              : (<>{/* In the group view the band names the group, so no GROUP column: NAME's heading opens or folds every group. */}
              {view === 'group' ? (
                <button type="button" className="av-in name av-gall" onClick={() => setShut(shut.size ? new Set() : new Set(grouped(rows).map((g) => g.name)))}>
                  name <span className="av-gall-do">{shut.size ? tr('av_t_open_all') : tr('av_t_shut_all')}</span></button>
              ) : <><span className="av-in group">group</span><span className="av-in name">name</span></>}<span className="av-in value">value</span><span className="av-in grow">comment</span></>)}
          </div>
          {view === 'group' ? grouped(rows).map((g) => (
            <div key={g.name} className="av-pgroup">
              {/* The whole band opens and shuts it; its checkbox and doc link do their own thing. */}
              <div className={`av-row av-band ${shut.has(g.name) ? 'shut' : 'open'}`} role="button" aria-expanded={!shut.has(g.name)}
                onClick={(e) => { if (!e.target.closest('input, button, a')) setShut((s) => { const n = new Set(s); n.has(g.name) ? n.delete(g.name) : n.add(g.name); return n }) }}>
                {check(g.rows.map((r) => r._k))}
                <span className="av-no" />
                {(() => {
                  const ps = g.rows.filter((r) => r.kind === 'parameter'), n = ps.filter(isOff).length
                  return ps.length ? <button type="button" className={`av-sq${n === ps.length ? ' on' : n ? ' some' : ''}`} title={tr('av_g_off')} disabled={locked}
                    onClick={() => change(toggle(rows, new Set(ps.map((r) => r._k))))}>#</button> : <span className="av-sq av-hd" />
                })()}
                <span className="av-title">{g.name === '#' ? tr('av_comments') : g.name || tr('av_no_group')}</span>
                {docOf(g.name) && <a className="av-doc" href={docOf(g.name)} target="_blank" rel="noreferrer">doc ↗</a>}
                <span className="av-tag">{g.rows.length} · {shut.has(g.name) ? tr('av_shut') : tr('av_open')}</span>
              </div>
              {!shut.has(g.name) && g.rows.map(line)}
            </div>
          )) : rows.map(line)}
          {!rows.length && <div className="av-say">{tr('av_empty')}</div>}
        </div>
      )}
    </div>
  )
}

// Any whitespace but a plain space (a line break, a tab, the Korean input's full-width space
// U+3000, a no-break space) becomes a plain space: LILAK splits a value on all of them.
export const plain = (v) => v.replace(/\s*\n\s*/g, ' ').replace(/[^\S ]/g, ' ')

// A value box that wraps to the screen's width and grows a line at a time; it stays one
// line in the file (Enter and pasted newlines become spaces).
function Wrap({ onChange, ...p }) {
  const el = useRef(null)
  const fit = () => { const t = el.current; if (t) { t.style.height = 'auto'; t.style.height = `${t.scrollHeight + 2}px` } }
  useLayoutEffect(fit, [p.value])
  useEffect(() => { const o = new ResizeObserver(fit); o.observe(el.current); return () => o.disconnect() }, [])
  return <textarea ref={el} rows={1} {...p} onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault() }}
    onChange={(e) => { e.target.value = plain(e.target.value); onChange(e) }} />
}

// A comment never makes its row taller: it shows as many lines as the row already has
// (one, unless the value wrapped) and ends in "…" past that. Clicked, the box opens whole
// and hangs down over the rows below, the row itself unchanged.
function Clip({ value, onChange, className, title, readOnly }) {
  const box = useRef(null)
  const [open, setOpen] = useState(false)
  const [n, setN] = useState(1)
  // Near the bottom of what scrolls (the last rows) the open box would hang out of sight:
  // there it grows upward instead, its bottom on the row's.
  const [up, setUp] = useState(false)
  useLayoutEffect(() => {
    const t = box.current?.querySelector('textarea')
    if (!open || !t) { setUp(false); return }
    const end = (box.current.closest('.rl-edit') || document.documentElement).getBoundingClientRect().bottom
    setUp(box.current.getBoundingClientRect().top + t.offsetHeight > end)
  }, [open, value])
  useEffect(() => {
    const o = new ResizeObserver(() => box.current && setN(Math.max(1, Math.floor(box.current.clientHeight / 18))))
    o.observe(box.current); return () => o.disconnect()
  }, [])
  return (
    <span ref={box} className={`av-clip ${className}${open ? ' open' : ''}${up ? ' up' : ''}`} title={open ? undefined : title} onClick={() => setOpen(true)}>
      {open ? <Wrap className="av-in av-clip-edit" autoFocus readOnly={readOnly} value={value} onChange={onChange} spellCheck={false} onBlur={() => setOpen(false)}
        onFocus={(e) => e.target.setSelectionRange(value.length, value.length)}
        onKeyUp={(e) => { if (e.key === 'Escape') e.target.blur() }} />
        : <span className="av-clip-text" style={{ WebkitLineClamp: n }}>{value}</span>}
    </span>
  )
}

// Where a `<` line's file is, asked a moment after the value stops changing.
function IncludeMark({ file, value, open }) {
  const [at, setAt] = useState(null)
  useEffect(() => {
    let live = true
    setAt(null)
    const t = setTimeout(() => findInclude(file, value).then((r) => live && setAt(r)), 600)
    return () => { live = false; clearTimeout(t) }
  }, [file, value])
  if (!value.trim() || !at || at.state === 'empty') return null
  if (at.state === 'found' && at.id) {
    return <button type="button" className="av-inc ok" title={tr('av_inc_open', at.path)} onClick={() => open?.(at.id)}>↗</button>
  }
  if (at.state === 'found') return <span className="av-inc ok" title={tr('av_inc_found', at.path)}>✓</span>
  if (at.state === 'missing') return <span className="av-inc bad" title={tr('av_inc_missing', (at.tried || []).join('\n'))}>!</span>
  return <span className="av-inc" title={tr('av_inc_unknown')}>?</span>
}
