import { useEffect, useRef, useState } from 'react'
import { portalUser, load, save } from 'racklist'
import { tr } from 'lilak-ui/i18n.jsx'
import { execStart, execState, addLog, updateLog, logbookProject, registerPars } from './api.js'
import { setStale, useStale, setRunState } from './toolstate.js'

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const KEY = (id) => `lilak_flow.run.${id}`
const TAIL = 20000   // what the browser keeps of root's output, for the drawer when you come back

/** Init or run this file here, and log it in the set's logbook: a log when it starts, its outcome
 *  (errors, the end of root's output) when it ends. The last run of each file is kept in the browser
 *  (the drawer's output, the logbook button); come back while it still runs and the page follows it
 *  again. Closed for good before the end, the log stays "running" (the run itself goes on). */
// ponytail: the page writes the outcome; a server-side write (a delegated token) if runs outlive pages.
// What LILAK names the run's output (atomx_0421.conv.root): Name_RunID.Tag, the log's name too.
const stem = (out, par) => {
  const base = String(out || '').split('/').pop().replace(/\.root$/, '')
  if (base) return base
  const n = par('LKRun/Name'), r = par('LKRun/RunID'), t = par('LKRun/Tag')
  return [n, r && `_${String(r).padStart(4, '0')}`, t && `.${t}`].filter(Boolean).join('') || ''
}

/** `pars`: the board's dry Init values ([[group/name, value]]); `out`: the output file it named. */
export default function RunLog({ id, path, block = '', exists = false, onAsk, pars = [], out, onState, openLog, openRec, openInit }) {
  const proj = logbookProject()
  const [now, setNow] = useState(null)      // { mode, seconds } while it runs
  const [said, setSaid] = useState(null)    // { ok, log, error }
  const [sure, setSure] = useState(false)   // Run pressed once over an output already there
  const live = useRef(true)
  useEffect(() => () => { live.current = false }, [])
  const par = (k) => pars.find(([x]) => x === k)?.[1] || ''
  const run = par('LKRun/RunID'), tag = par('LKRun/Tag')
  const name = stem(out, par) || path.split('/').pop()
  const stale = useStale(id)   // changed since the last good Init: Init first, Run waits
  const keep = (r) => save(KEY(id), { ...r, st: r.st && { ...r.st, tail: String(r.st.tail || '').slice(-TAIL) } })

  // Watch run `rid` to its end, then write its outcome to the log.
  const follow = async (mode, rid, log, backup = '') => {
    const Mode = mode === 'init' ? 'Init' : 'Run'
    let st
    for (;;) {
      try { st = await execState(rid) } catch (e) {
        if (live.current) { setNow(null); setSaid({ log, error: e.message }) }
        return
      }
      if (live.current) setNow(st.done ? null : { mode, seconds: st.seconds })
      onState?.({ mode, rid, st })
      keep({ mode, rid, log, st, backup })
      if (st.done) break
      await wait(2000)
      if (!live.current) return   // left: the next visit picks it up
    }
    const body = [
      `${path}`,
      `${st.ok ? (mode === 'init' ? 'Initialized' : 'Run done') : `${Mode} ${tr('av_run_failed')}`}, exit ${st.returncode}, ${st.seconds} s`,
      ...(backup && mode === 'run' ? [tr('av_over_kept', backup)] : []),   // an Init's goes back when it ends
      ...(st.errors.length ? ['', tr('av_run_errors'), ...st.errors] : []),
      '', '--- root ---', st.tail.replace(/\x1b\[[0-9;]*m/g, '').slice(-4000),
    ].join('\n')
    try {
      if (log) log = { ...(await updateLog(log.id, { title: `${name} ${log.at || ''} ${Mode}${st.ok ? '' : ` ${tr('av_run_failed')}`}`, body })), at: log.at, params: log.params }
    } catch (e) { if (live.current) setSaid({ error: tr('av_run_nolog', e.message) }) }
    if (st.ok) setStale(id, false)
    window.dispatchEvent(new CustomEvent('lilak_flow:ran', { detail: { id } }))   // the output card reads its RunHeader again
    keep({ mode, rid, log: log && { id: log.id, title: log.title, at: log.at, params: log.params }, st, written: true, fresh: !!log })
    if (live.current) setSaid((s) => ({ ...s, ok: st.ok, log, fresh: !!log }))
  }

  // Back on this file: its last run as it was left, and still followed if it was going.
  useEffect(() => {
    const r = load(KEY(id), null)
    setSaid(r ? { ok: r.st?.ok, log: r.log, fresh: !!r.fresh } : null)
    setNow(null)
    if (!r) { onState?.(null); return }
    onState?.({ mode: r.mode, rid: r.rid, st: r.st })
    if (!r.written) follow(r.mode, r.rid, r.log, r.backup)
  }, [id])   // eslint-disable-line react-hooks/exhaustive-deps

  const go = async (mode) => {
    const Mode = mode === 'init' ? 'Init' : 'Run'
    if (mode === 'init') openInit?.()   // the values after Init, beside the run's output
    setSaid(null)
    let rid, log, backup = ''
    try {
      ({ rid, backup = '' } = await execStart(id, mode))
    } catch (e) { setSaid({ error: /Method Not Allowed|^40[45]$/.test(e.message) ? tr('av_old_server') : e.message }); return }
    setNow({ mode, seconds: 0 })
    onState?.({ mode, rid, st: null })
    const d = new Date(), pad = (n) => String(n).padStart(2, '0')
    const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
    // The values a Run starts from (the board's Init of the file as saved), kept in parameters.
    let params = []
    try {
      // Only a Run's values are a parameter set (an Init only checks the file).
      const set = mode === 'run' && pars.length && await registerPars(pars.map(([k, v]) => `${k} ${v}`).join('\n') + '\n', `${name} ${date} ${time} ${Mode}`)
      if (set) params = [set]
    } catch (e) { setSaid({ error: tr('av_run_nopars', e.message) }) }
    try {
      log = await addLog({ date, time, author: portalUser()?.email || '', title: `${name} ${date} ${time} ${Mode}`,
        run, tags: ['lilak_flow', mode, ...(tag ? [tag] : [])], params, body: `${path}\n${tr('av_run_started')}` })
      log = { id: log.id, title: log.title, at: `${date} ${time}`, params: params[0] || null }
    } catch (e) { setSaid({ error: tr('av_run_nolog', e.message) }) }
    keep({ mode, rid, log, st: null, backup })
    await follow(mode, rid, log, backup)
  }

  const seen = () => {
    setSaid((x) => ({ ...x, fresh: false }))
    const r = load(KEY(id), null)
    if (r?.fresh) save(KEY(id), { ...r, fresh: false })
  }

  const goRef = useRef(null)
  goRef.current = proj ? go : null
  useEffect(() => {
    const on = (e) => { if (e.detail?.id === id && !now) goRef.current?.(e.detail.mode) }
    window.addEventListener('lilak_flow:exec', on)
    return () => window.removeEventListener('lilak_flow:exec', on)
  }, [id, now])
  // The Run button as it stands (off and why, asking before it writes over), for a copy of it elsewhere
  // (the Init values tab): that copy presses this one (lilak_flow:press), so it does just what this does.
  const runOff = !!now || !proj || stale || !!block
  const runTitle = !proj ? tr('av_run_noset') : block ? tr(block) : stale ? tr('av_run_stale') : tr('av_run_run_hint', proj)
  const runLabel = now?.mode === 'run' ? `Run · ${now.seconds} s` : sure ? tr('av_over_sure') : 'Run'
  const pressRun = () => (exists && !sure ? (setSure(true), onAsk?.()) : (setSure(false), go('run')))
  const pressRef = useRef(pressRun)
  pressRef.current = runOff ? null : pressRun
  useEffect(() => { setRunState(id, { off: runOff, title: runTitle, label: runLabel, sure }) }, [id, runOff, runTitle, runLabel, sure])
  useEffect(() => {
    const on = (e) => { if (e.detail?.id === id) pressRef.current?.() }
    window.addEventListener('lilak_flow:press', on)
    return () => window.removeEventListener('lilak_flow:press', on)
  }, [id])
  return (
    <>
      {['init', 'run'].map((m) => (
        <button key={m} type="button" className={`rl-btn${(m === 'run') !== stale ? ' av-go' : ''}`} disabled={!!now || !proj || (m === 'run' && (stale || !!block))}
          title={!proj ? tr('av_run_noset') : m === 'run' && block ? tr(block) : m === 'run' && stale ? tr('av_run_stale') : tr(`av_run_${m}_hint`, proj)}
          onBlur={() => setSure(false)}
          onClick={() => (m === 'run' && exists && !sure ? (setSure(true), onAsk?.()) : (setSure(false), go(m)))}>
          {now?.mode === m ? `${m === 'init' ? 'Init' : 'Run'} · ${now.seconds} s` : m === 'run' && sure ? tr('av_over_sure') : m === 'init' ? 'Init' : 'Run'}</button>
      ))}
      {/* Coloured while the run's log is new to the reader: a finished run wrote it, nobody opened it yet. */}
      <button type="button" className={`rl-btn${said?.fresh ? ' av-new' : ''}`} disabled={!said?.log}
        title={said?.log ? `${said.log.title}${said.fresh ? ` — ${tr('av_log_new')}` : ''}` : tr('av_log_none')}
        onClick={() => { openLog?.(said.log); seen() }}>logbook</button>
      <button type="button" className="rl-btn" disabled={!said?.log?.params} title={said?.log?.params ? tr('av_pars_open') : tr('av_pars_none')}
        onClick={() => openRec?.(said.log.params, `parameters · ${name}`)}>parameters</button>
      {said?.error && <span className="av-bad" title={said.error}>{said.error}</span>}
    </>
  )
}
