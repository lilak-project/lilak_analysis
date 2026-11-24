import { useEffect, useMemo, useState } from 'react'
import { tr } from 'lilak-ui/i18n.jsx'
import { loadFile, saveFile, checkPaths, searchCheck, fixOutDir, listDir } from './api.js'
import { openBrowse } from 'racklist'
import Icon from 'lilak-ui/icons.jsx'
import { applyGuide, isOff, fromFile } from './rows.js'
import { withEnv } from './layout.js'
import { useEnv, useLocked, toggleLock, isLocked, setStale } from './toolstate.js'
import { bytes } from './FileInfo.jsx'

/**
 * The guide: a file's run, its input and its output set one box at a time, each step saying what
 * it is for; Confirm writes them into the file (the Run card's guide does all three in a row, the
 * Input File and Output File cards' their own). A step is { key, title, body(), check? }; the steps
 * of a part follow from what was chosen (search or write the input files). Other classes' guides
 * can follow the same shape later.
 */

const pad4 = (n) => String(n).padStart(4, '0')
const listOf = (s) => String(s || '').split(/[\s,]+/).map((x) => x.trim()).filter(Boolean)
/** RunIDRange "a, b" (pairs) → every run in it; RunIDList "1, 2, 5" → those. */
export const runsOf = (d, env) => {
  const n = (x) => parseInt(withEnv(x, env), 10)
  if (d.runKind === 'list') return listOf(d.list).map(n).filter((x) => !Number.isNaN(x))
  if (d.runKind === 'range') {
    const v = listOf(d.range).map(n), out = []
    for (let i = 0; i + 1 < v.length; i += 2) for (let r = v[i]; r <= v[i + 1] && out.length < 2000; r += 1) out.push(r)
    return out
  }
  return Number.isNaN(n(d.run)) ? [] : [n(d.run)]
}

/** The file's LKRun lines (on ones only) as the guide's starting values. */
function draftOf(rows) {
  const on = rows.filter((r) => r.kind === 'parameter' && r.group === 'LKRun' && !isOff(r))
  const one = (n) => on.find((r) => r.name === n)?.value ?? ''
  const all = (n) => on.filter((r) => r.name === n).map((r) => String(r.value ?? ''))
  const [search = '', how = ''] = String(one('SearchRun')).split(/\s+/)
  // lilak/run: how many events a Run goes through (0 = all of them).
  const n = rows.find((r) => r.kind === 'parameter' && r.group === 'lilak' && r.name === 'run' && !isOff(r))?.value
  return {
    events: n && String(n).trim() !== '0' ? String(n).trim() : '', allEvents: !n || String(n).trim() === '0',
    recursive: how === 'recursive',
    name: one('Name'), mode: all('InputFile').length && !search ? 'direct' : 'search',
    tag: !search || search === 'mfm' ? 'mfm' : 'root', rootTag: search && search !== 'mfm' ? search : '',
    paths: all('InputPath').length ? all('InputPath') : [''], files: all('InputFile').length ? all('InputFile') : [''],
    runKind: one('RunIDRange') ? 'range' : one('RunIDList') ? 'list' : 'one',
    run: one('RunID'), list: one('RunIDList'), range: one('RunIDRange'),
    outTag: one('Tag'), outPath: one('OutputPath'),
  }
}

/** What the guide writes: { set, off } for applyGuide, for the parts it went through. */
export function changesOf(d, parts) {
  const set = {}, off = []
  if (parts.includes('run')) { set['LKRun/Name'] = [d.name]; set['lilak/run'] = [d.allEvents ? '0' : String(d.events).trim()] }
  if (parts.includes('input')) {
    if (d.mode === 'search') {
      set['LKRun/SearchRun'] = [d.tag === 'mfm' ? (d.recursive ? 'mfm recursive' : 'mfm') : d.rootTag]
      set['LKRun/InputPath'] = d.paths.filter((p) => p.trim())
      off.push('LKRun/InputFile')
      if (d.runKind === 'one') { set['LKRun/RunID'] = [d.run]; off.push('LKRun/RunIDList', 'LKRun/RunIDRange') }
      if (d.runKind === 'list') { set['LKRun/RunIDList'] = [listOf(d.list).join(', ')]; off.push('LKRun/RunIDRange') }
      if (d.runKind === 'range') { set['LKRun/RunIDRange'] = [listOf(d.range).join(', ')]; off.push('LKRun/RunIDList') }
    } else {
      set['LKRun/InputFile'] = d.files.filter((p) => p.trim())
      off.push('LKRun/SearchRun', 'LKRun/InputPath')
    }
  }
  if (parts.includes('output')) { set['LKRun/Tag'] = [d.outTag]; set['LKRun/OutputPath'] = [d.outPath] }
  return { set, off }
}

/** One path box (or, `many`, a list of them) with a Browse button: the rack's browsing tab opens
 *  beside, at the box's folder (a relative one from this file's), and what is picked there comes back
 *  into the box (`pickInto(i, path)`, which sees the guide as it is then). */
function Paths({ id, list, set, pickInto, want, many, api, title }) {
  const put = (i, v) => set(list.map((x, j) => (j === i ? v : x)))
  const browse = async (i, from) => {
    let start = ''
    try { start = (await checkPaths(id, { dirs: [list[i] || '.'] })).dirs[0].full } catch { /* the first allowed folder */ }
    openBrowse(api, { title: `${tr('av_g_browse')} · ${title}`, want, start: want === 'file' && list[i] ? start.replace(/\/[^/]*$/, '') : start,
      onPick: (v) => pickInto(i, v), from })
  }
  return (<>
    {list.map((p, i) => (
      <div key={i} className="av-g-line">
        <input className="rl-in av-g-in" value={p} placeholder={want === 'dir' ? '/path/to/folder' : '/path/to/file.root'} onChange={(e) => put(i, e.target.value)} />
        <button type="button" className="rl-btn" disabled={!api?.openEdit} onClick={(e) => browse(i, e.currentTarget)}><Icon name="folder" size={13} /> {tr('av_g_browse')}</button>
        {many && list.length > 1 && <button type="button" className="rl-btn" onClick={() => set(list.filter((_, j) => j !== i))}>✕</button>}
      </div>
    ))}
    {many && <button type="button" className="rl-btn" onClick={() => set([...list, ''])}>+ {tr(want === 'dir' ? 'av_g_add_path' : 'av_g_add_file')}</button>}
  </>)
}

const Choice = ({ value, set, options }) => (
  <div className="av-g-line">{options.map(([v, label]) => (
    <button key={v} type="button" className={`rl-btn${value === v ? ' on' : ''}`} onClick={() => set(v)}>{label}</button>
  ))}</div>
)

/** A check a step runs when it comes up (and again on its button): what it found, good or not. */
function useCheck(run, deps) {
  const [got, setGot] = useState(null)
  const again = () => { setGot({ busy: true }); run().then(setGot).catch((e) => setGot({ error: e.message })) }
  useEffect(again, deps)   // eslint-disable-line react-hooks/exhaustive-deps
  return [got, again]
}

/** "Folders just inside": each folder written gets the folders right inside it added below it, one line
 *  each, for LILAK to look in (it looks only right inside each InputPath). One level, no deeper. */
function SubFolders({ id, d, put }) {
  const [said, setSaid] = useState('')
  const add = async () => {
    setSaid('')
    try {
      const typed = d.paths.filter((p) => p.trim())
      const full = (await checkPaths(id, { dirs: typed })).dirs
      const out = []
      for (let i = 0; i < typed.length; i += 1) {
        out.push(typed[i])
        if (!full[i]?.exists) continue
        const at = await listDir(full[i].full)
        out.push(...at.dirs.map((x) => `${at.path}/${x.name}`))
      }
      const all = [...new Set(out)]
      if (all.length === typed.length) setSaid(tr('av_g_sub_none'))
      put({ recursive: false, paths: all })
    } catch (e) { setSaid(e.message) }
  }
  return (<>
    <div className="av-g-line"><button type="button" className="rl-btn" onClick={add}><Icon name="folder-plus" size={13} /> {tr('av_g_sub_add')}</button></div>
    <div className="av-say">{said || tr('av_g_sub_say')}</div>
  </>)
}

function SearchCheck({ id, d, env, put }) {
  const runs = runsOf(d, env)
  const [moved, setMoved] = useState(null)   // { at, subs }: a folder whose runs were found below it
  const [got, again] = useCheck(() => searchCheck(id, { tag: d.tag === 'mfm' ? 'mfm' : d.rootTag, paths: d.paths, runs, name: withEnv(d.name, env), recursive: d.recursive }), [d.paths.join('\n'), d.recursive])
  // Found below a folder (Scope looks at every depth; LILAK only right inside each InputPath): the
  // folders that hold them become the InputPaths written, and the check runs again on them.
  useEffect(() => {
    const deeper = Object.entries(got?.deeper || {})
    if (!deeper.length) return
    // The folders just inside that hold the runs are added below their folder, one line each (what
    // LILAK then looks in is in sight, and nothing deeper — a backup, a merge — slips in).
    const subs = deeper.flatMap(([, ss]) => ss)
    setMoved({ at: deeper.map(([at]) => at).join(', '), subs })
    put((x) => ({ recursive: false, paths: [...new Set([...x.paths.filter((p) => p.trim()), ...subs])] }))
  }, [got])   // eslint-disable-line react-hooks/exhaustive-deps
  if (!got || got.busy) return <div className="av-say">{tr('av_g_checking')}</div>
  if (got.error) return <div className="av-say bad">{got.error}</div>
  const n = Object.values(got.runs).reduce((a, fs) => a + fs.length, 0)
  return (<>
    {/* The folders looked in, each there or not. */}
    <div className="av-g-files">{got.dirs.map((x) => (
      <div key={x.path} className={x.exists ? '' : 'bad'}>{x.exists ? '⌕' : '✗'} {x.path}{x.exists ? '' : ` · ${tr('av_dir_none')}`}</div>
    ))}</div>
    <div className={`av-say ${n ? 'ok' : 'bad'}`}>{n ? tr('av_g_found', n, runs.length) : tr('av_g_found_none')}</div>
    <div className="av-g-files">{Object.entries(got.runs).slice(0, 50).flatMap(([r, fs]) => (fs.length ? fs : [null]).map((f, i) => (
      <div key={`${r}${i}`} className={f ? '' : 'bad'}>{`run ${r}: `}{f || tr('av_g_found_none')}</div>
    )))}</div>
    {moved && <div className="av-g-deeper"><div className="av-say">{tr('av_g_deeper_added', moved.at, moved.subs.length)}</div></div>}
    <button type="button" className="rl-btn" onClick={again}>{tr('av_g_check_again')}</button>
  </>)
}

function FileCheck({ id, files }) {
  const [got, again] = useCheck(() => checkPaths(id, { files: files.filter((f) => f.trim()) }), [])
  if (!got || got.busy) return <div className="av-say">{tr('av_g_checking')}</div>
  if (got.error) return <div className="av-say bad">{got.error}</div>
  return (<>
    {got.files.map((f) => <div key={f.path} className={`av-say ${f.exists ? 'ok' : 'bad'}`}>{f.exists ? '✓' : '✗'} {f.full}{f.exists ? ` · ${bytes(f.size)}` : ` · ${tr('av_file_none')}`}</div>)}
    <button type="button" className="rl-btn" onClick={again}>{tr('av_g_check_again')}</button>
  </>)
}

function OutDirCheck({ id, path }) {
  const [to, setTo] = useState('')
  const [said, setSaid] = useState('')
  const [got, again] = useCheck(() => checkPaths(id, { dirs: [path || '.'] }), [path])
  const fix = (what) => fixOutDir(id, { path: path || '.', ...what }).then(() => { setSaid(''); again() }).catch((e) => setSaid(e.message))
  if (!got || got.busy) return <div className="av-say">{tr('av_g_checking')}</div>
  if (got.error) return <div className="av-say bad">{got.error}</div>
  const dir = got.dirs[0]
  return (<>
    <div className={`av-say ${dir.exists ? 'ok' : 'bad'}`}>{dir.exists ? '✓' : '✗'} {dir.full} · {dir.exists ? tr('av_dir_ok') : tr('av_dir_none')}</div>
    {!dir.exists && (<>
      <div className="av-say">{tr('av_g_outdir_what')}</div>
      <div className="av-g-line">
        <button type="button" className="rl-btn" onClick={() => fix({ make: true })}>{tr('av_dir_make')}</button>
        <span className="av-sub">{tr('av_dir_or')}</span>
        <input className="rl-in av-g-in" value={to} placeholder={tr('av_dir_link_to')} onChange={(e) => setTo(e.target.value)} />
        <button type="button" className="rl-btn" disabled={!to.trim()} onClick={() => fix({ link: to.trim() })}>{tr('av_dir_link')}</button>
      </div>
      <div className="av-say">{tr('av_g_outdir_back')}</div>
    </>)}
    {said && <div className="av-say bad">{said}</div>}
  </>)
}

function OutFileCheck({ id, file }) {
  const [got, again] = useCheck(() => checkPaths(id, { files: [file] }), [file])
  if (!got || got.busy) return <div className="av-say">{tr('av_g_checking')}</div>
  if (got.error) return <div className="av-say bad">{got.error}</div>
  const f = got.files[0]
  return (<>
    <div className="av-say">{f.full}</div>
    {f.exists
      ? <div className="av-say bad">{tr('av_g_outfile_there', new Date(f.mtime * 1000).toLocaleString(), bytes(f.size))}</div>
      : <div className="av-say ok">{tr('av_g_outfile_new')}</div>}
    <button type="button" className="rl-btn" onClick={again}>{tr('av_g_check_again')}</button>
  </>)
}

/** The steps of each part, for what has been chosen so far. */
function stepsOf(part, d, put, id, env, api) {
  const pathsSet = (k) => (v) => put({ [k]: v })
  // What the browsing tab picked, into box i of list k, of the guide as it is when it comes back.
  const into = (k) => (i, v) => put((x) => ({ [k]: x[k].map((y, j) => (j === i ? v : y)) }))
  const run = { key: 'name', part: 'run', title: tr('av_g_name'), say: tr('av_g_name_say'),
    body: <input className="rl-in av-g-in" autoFocus value={d.name} placeholder="atomx" onChange={(e) => put({ name: e.target.value })} />,
    ok: !!d.name.trim() }
  const mode = { key: 'mode', part: 'input', title: tr('av_g_mode'), say: tr('av_g_mode_say'),
    body: <Choice value={d.mode} set={(v) => put({ mode: v })} options={[['search', tr('av_g_mode_search')], ['direct', tr('av_g_mode_direct')]]} />, ok: true }
  const search = [
    { key: 'tag', part: 'input', title: tr('av_g_tag'), say: d.tag === 'mfm' ? tr('av_g_tag_mfm') : tr('av_g_tag_root', withEnv(d.name, env) || 'Name'),
      body: (<>
        <Choice value={d.tag} set={(v) => put({ tag: v })} options={[['mfm', 'mfm'], ['root', tr('av_g_tag_rootpick')]]} />
        {d.tag === 'root' && <input className="rl-in av-g-in" value={d.rootTag} placeholder="conv" onChange={(e) => put({ rootTag: e.target.value })} />}
      </>), ok: d.tag === 'mfm' || !!d.rootTag.trim() },
    { key: 'paths', part: 'input', title: tr('av_g_paths'), say: tr('av_g_paths_say'),
      body: (<>
        <Paths id={id} api={api} title={tr('av_g_paths')} list={d.paths} set={pathsSet('paths')} pickInto={into('paths')} want="dir" many />
        <SubFolders id={id} d={d} put={put} />
      </>), ok: d.paths.some((p) => p.trim()) },
    { key: 'runs', part: 'input', title: tr('av_g_runs'), say: tr('av_g_runs_say'),
      body: (<>
        <Choice value={d.runKind} set={(v) => put({ runKind: v })} options={[['one', tr('av_g_run_one')], ['list', 'RunIDList'], ['range', 'RunIDRange']]} />
        {d.runKind === 'one' && <input className="rl-in av-g-in" value={d.run} placeholder="421" onChange={(e) => put({ run: e.target.value })} />}
        {d.runKind === 'list' && <input className="rl-in av-g-in" value={d.list} placeholder="421, 422, 425" onChange={(e) => put({ list: e.target.value })} />}
        {d.runKind === 'range' && <input className="rl-in av-g-in" value={d.range} placeholder="421, 430" onChange={(e) => put({ range: e.target.value })} />}
        <div className="av-say">{tr(`av_g_run_${d.runKind}_say`)}{runsOf(d, env).length > 1 ? ` (${tr('av_g_runs_n', runsOf(d, env).length)})` : ''}</div>
      </>), ok: runsOf(d, env).length > 0 },
    { key: 'found', part: 'input', title: tr('av_g_found_title'), say: tr('av_g_found_say'),
      body: <SearchCheck id={id} d={d} env={env} put={put} />, ok: true },
  ]
  const direct = [
    { key: 'files', part: 'input', title: tr('av_g_files'), say: tr('av_g_files_say'),
      body: <Paths id={id} api={api} title={tr('av_g_files')} list={d.files} set={pathsSet('files')} pickInto={into('files')} want="file" many />, ok: d.files.some((p) => p.trim()) },
    { key: 'filecheck', part: 'input', title: tr('av_g_found_title'), say: tr('av_g_filecheck_say'),
      body: <FileCheck id={id} files={d.files} />, ok: true },
  ]
  const outFile = `${d.outPath || '.'}/${withEnv(d.name, env)}_${pad4(runsOf(d, env)[0] ?? 0)}.${d.outTag}.root`
  const output = [
    { key: 'outtag', part: 'output', title: tr('av_g_outtag'), say: tr('av_g_outtag_say'),
      body: <input className="rl-in av-g-in" value={d.outTag} placeholder="conv" onChange={(e) => put({ outTag: e.target.value })} />, ok: !!d.outTag.trim() },
    { key: 'outpath', part: 'output', title: tr('av_g_outpath'), say: tr('av_g_outpath_say'),
      body: <Paths id={id} api={api} title={tr('av_g_outpath')} list={[d.outPath]} set={(v) => put({ outPath: v[0] })} pickInto={(i, v) => put({ outPath: v })} want="dir" />, ok: true },
    { key: 'outdir', part: 'output', title: tr('av_g_outdir'), say: tr('av_g_outdir_say'), body: <OutDirCheck id={id} path={d.outPath} />, ok: true },
    { key: 'outfile', part: 'output', title: tr('av_g_outfile'), say: tr('av_g_outfile_say'), body: <OutFileCheck id={id} file={outFile} />, ok: true },
  ]
  const events = { key: 'events', part: 'run', title: tr('av_g_events'), say: tr('av_g_events_say'),
    body: (<>
      <Choice value={d.allEvents ? 'all' : 'some'} set={(v) => put({ allEvents: v === 'all' })} options={[['all', tr('av_g_events_all')], ['some', tr('av_g_events_some')]]} />
      {!d.allEvents && <input className="rl-in av-g-in" type="number" min="1" value={d.events} placeholder="100" onChange={(e) => put({ events: e.target.value })} />}
    </>), ok: d.allEvents || parseInt(d.events, 10) > 0 }
  if (part === 'run') return [run, events]
  if (part === 'input') return [mode, ...(d.mode === 'search' ? search : direct)]
  return output
}

/** Each open guide's values and step, by `which|id`, across its pane coming and going. */
const kept = new Map()
/** A guide opened anew (its button pressed) starts from the file as it is, not from what an earlier one left. */
export function freshGuide(which, id) {
  kept.delete(`${which}|${id}`)
  window.dispatchEvent(new CustomEvent('lilak_flow:guide-fresh', { detail: { key: `${which}|${id}` } }))   // one open now starts over
}

const PARTS = { run: ['run', 'input', 'output'], inputfile: ['input'], outputfile: ['output'] }

/** The guide for file `id` from card `which` (run, inputfile, outputfile), in an editor pane. */
export default function Guide({ id, which, api }) {
  const parts = PARTS[which] || ['run']
  const env = useEnv(id)
  const locked = useLocked(id)
  // Kept outside the pane: a tab not in sight is taken down (the browsing tab beside it, picking),
  // and what is picked there still lands here.
  const key = `${which}|${id}`
  const [d, showD] = useState(() => kept.get(key)?.d || null)
  const [at, showAt] = useState(() => kept.get(key)?.at || 0)
  const setD = (f) => { const nd = typeof f === 'function' ? f(kept.get(key)?.d ?? null) : f; kept.set(key, { ...kept.get(key), d: nd }); showD(nd) }
  const setAt = (n) => { kept.set(key, { ...kept.get(key), at: n }); showAt(n) }
  const [said, setSaid] = useState('')
  const [done, setDone] = useState(false)
  const read = () => loadFile(id).then((f) => { setD(draftOf(fromFile(f.rows || []))); setAt(0); setSaid(''); setDone(false) }).catch((e) => setSaid(e.message))
  useEffect(() => { if (!kept.get(key)?.d) read() }, [key])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const on = (e) => { if (e.detail?.key === key) read() }
    window.addEventListener('lilak_flow:guide-fresh', on)
    return () => window.removeEventListener('lilak_flow:guide-fresh', on)
  }, [key])   // eslint-disable-line react-hooks/exhaustive-deps
  const put = (patch) => setD((x) => ({ ...x, ...(typeof patch === 'function' ? patch(x) : patch) }))
  const steps = useMemo(() => (d ? parts.flatMap((p) => stepsOf(p, d, put, id, env, api)) : []), [d, env])   // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <div className="av-say">{said || tr('av_loading')}</div>
  const step = steps[Math.min(at, steps.length - 1)]
  const last = at >= steps.length - 1
  // Confirm writes even into a locked file: the lock is let go for this one write and put back after
  // (once the open editor has saved it, or at once when the file was written straight).
  const confirm = () => {
    const { set, off } = changesOf(d, parts)
    const was = locked
    if (was) toggleLock(id)
    const relock = () => {
      if (!was) return
      let done = false
      const back = () => { if (!done) { done = true; window.removeEventListener('lilak_flow:saved', saved); if (!isLocked(id)) toggleLock(id) } }
      const saved = (e) => { if (e.detail?.id === id) back() }
      window.addEventListener('lilak_flow:saved', saved)
      setTimeout(back, 3000)
    }
    const detail = { id, fn: (rows) => applyGuide(rows, set, off), reply: (msg) => {
      setSaid(msg || ''); setDone(!msg); relock()
      // Written: the guide is done, its tab goes (and what it held with it).
      if (!msg) { kept.delete(key); api?.closeEdit?.(`guide:${which}:${id}`) }
    } }
    window.dispatchEvent(new CustomEvent('lilak_flow:apply', { detail }))
    if (!detail.heard) {
      // No board of this file open to take it: written to the file straight (marked changed, Init to check).
      loadFile(id).then((f) => saveFile(id, f.version, { rows: applyGuide(f.rows, set, off) }))
        .then((r) => { if (r?.conflict) throw new Error(tr('av_changed_under')); setStale(id, true); detail.reply('') })
        .catch((e) => detail.reply(e.message))
    }
  }
  return (
    <div className="av-guide">
      <div className="av-g-trail">{steps.map((s, i) => (
        <button key={s.key} type="button" className={`av-g-dot${i === at ? ' on' : ''}${i < at ? ' past' : ''}${s.ok ? '' : ' bad'}`} title={s.title}
          onClick={() => setAt(i)}>{i === 0 || steps[i - 1].part !== s.part ? <b>{tr(`av_g_part_${s.part}`)}</b> : null}{i + 1}</button>
      ))}</div>
      {/* Back / Next / Confirm first, under the trail: they stay put whatever height the step has. */}
      <div className="av-g-foot">
        <button type="button" className="rl-btn" disabled={at === 0} onClick={() => setAt(at - 1)}>{tr('av_g_back')}</button>
        {/* Next, or on the last step Confirm in its place: Back never moves, nothing stands after them. */}
        {!last && <button type="button" className="rl-btn rl-go" disabled={!step.ok} onClick={() => setAt(at + 1)}>{tr('av_g_next')}</button>}
        {/* Not greyed out when a step still wants filling: pressed, it goes to that step and says so. */}
        {last && <button type="button" className="rl-btn rl-go" onClick={() => {
          const bad = steps.findIndex((s) => !s.ok)
          if (bad >= 0) { setAt(bad); setSaid(tr('av_g_fill', bad + 1, steps[bad].title)) } else confirm()
        }}>{tr('av_g_confirm')}</button>}
        {done && <span className="av-say ok">{tr('av_g_done')}</span>}
        {said && <span className="av-say bad">{said}</span>}
      </div>
      <div className="av-g-step">
        <div className="av-g-title">{at + 1}. {step.title}</div>
        <div className="av-g-say">{step.say}</div>
        <div className="av-g-body" key={step.key}>{step.body}</div>
      </div>
    </div>
  )
}
