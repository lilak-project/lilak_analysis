import { useEffect, useRef, useState } from 'react'
import { load, save } from 'racklist'
import { tr } from 'lilak-ui/i18n.jsx'

const plain = (s) => String(s || '').replace(/\x1b\[[0-9;]*m/g, '')
const tone = (l) => (/error>|\bError\b|[Ff]ailed|does not exist/.test(l) ? 'bad' : /warn>/.test(l) ? 'warn' : '')

/** The drawer under the board (as the rack list's 나열): this file's last Init or Run, its root
 *  output as it comes. Folded, its handle says how the run went. */
export default function RunPanel({ run, open, setOpen }) {
  const box = useRef(null)
  // The log's height, dragged by the grip on the handle's right third; kept for next time.
  const [h, setH] = useState(() => load('lilak_flow.runpanel.h', 260))
  const drag = (e) => {
    e.preventDefault()
    const y0 = e.clientY, h0 = h
    let last = h0
    const move = (ev) => { last = Math.max(80, Math.min(window.innerHeight - 160, h0 + y0 - ev.clientY)); setH(last) }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); save('lilak_flow.runpanel.h', last) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    if (!open) setOpen(true)
  }
  const st = run?.st
  const Mode = run?.mode === 'run' ? 'Run' : 'Init'
  const state = !run ? tr('av_panel_none') : !st?.done ? `${Mode} · ${tr('av_run_running')} · ${st?.seconds ?? 0} s`
    : `${st.ok ? (run.mode === 'run' ? 'Run done' : 'Initialized') : `${Mode} ${tr('av_run_failed')}`} · exit ${st.returncode} · ${st.seconds} s${st.errors.length ? ` · ${tr('av_panel_errors', st.errors.length)}` : ''}`
  // Always at the newest line.
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight
  }, [st?.tail, open])
  return (
    <div className="rl-out av-runpanel">
      <div className="av-runhead">
        <button type="button" className={`rl-outhead${open ? ' on' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open}>
          <i className="rl-caret">{open ? '▾' : '▸'}</i>
          <span>{tr('av_panel')}</span>
          <span className={`rl-hint${st?.done && !st.ok ? ' av-bad' : ''}`}>{state}</span>
        </button>
        <span className="av-grip" title={tr('av_panel_grip')} onPointerDown={drag} />
      </div>
      {open && (
        <div className="av-runlog" ref={box} style={{ height: h }}>
          {st?.tail ? plain(st.tail).split('\n').map((l, i) => <div key={i} className={tone(l)}>{l || ' '}</div>)
            : <div className="dim">{run ? tr('av_run_running') : tr('av_panel_hint')}</div>}
        </div>
      )}
    </div>
  )
}
