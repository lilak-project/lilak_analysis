import { useEffect, useState } from 'react'
import { tr } from 'lilak-ui/i18n.jsx'
import { loadRunHeader, loadOutPars, fixOutDir } from './api.js'
import { useInit } from './toolstate.js'
import { differ } from './layout.js'

export const bytes = (n) => (n == null ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`)
const when = (t) => (t ? new Date(t * 1000).toLocaleString() : '')

function One({ f }) {
  return (
    <div className="av-row av-finfo">
      <span className={`av-fok ${f.exists ? 'ok' : 'bad'}`}>{f.exists ? '✓' : '✗'}</span>
      <span className="av-in av-fpath" title={f.full || f.path}>{f.full || f.path}</span>
      <span className="av-fsz">{f.exists ? bytes(f.size) : tr('av_file_none')}</span>
      <span className="av-ftm">{when(f.mtime)}</span>
    </div>
  )
}

const Head = ({ children }) => <div className="av-row av-head av-cols av-fhead"><span className="av-in av-fpath">{children}</span></div>

/** What LILAK wrote of the run with the output (its RunHeader), compact: one row a parameter.
 *  Read again when a run here ends; the output as it is now beside it. */
function RunHeader({ out, id }) {
  const [got, setGot] = useState(null)
  useEffect(() => {
    let live = true
    const read = () => loadRunHeader(out).then((r) => live && setGot(r)).catch((e) => live && setGot({ error: e.message }))
    read()
    window.addEventListener('lilak_flow:ran', read)
    return () => { live = false; window.removeEventListener('lilak_flow:ran', read) }
  }, [out])
  if (!got) return null
  if (got.error) return <div className="av-say bad">{got.error}</div>
  return (<>
    <One f={got.file} />
    {got.file.exists && <Compare out={out} id={id} at={got.file.mtime} />}
    <Head>{tr('av_file_header')}</Head>
    {got.rows.length ? got.rows.map(([k, v], i) => (
      <div key={i} className="av-row av-prow av-hrow"><span className="av-in name" title={k}>{k}</span><span className="av-in value" title={v}>{v}</span></div>
    )) : <div className="av-say">{tr('av_file_header_none')}</div>}
  </>)
}

/** The output's own parameters (what it was made with) against the file's Init values now. */
function Compare({ out, id, at }) {
  const init = useInit(id)   // { name: [value, …] }
  const [got, setGot] = useState(null)
  useEffect(() => {
    let live = true
    setGot(null)
    loadOutPars(out).then((r) => live && setGot(r)).catch((e) => live && setGot({ error: e.message }))
    return () => { live = false }
  }, [out, at])
  if (!got) return <div className="av-say">{tr('av_cmp_reading')}</div>
  if (got.error) return <div className="av-say bad">{got.error}</div>
  const now = Object.entries(init).flatMap(([k, vs]) => vs.map((v) => [k, v]))
  if (!now.length) return null
  const d = differ(got.pars, now)
  return (<>
    <Head>{d.length ? tr('av_cmp_diff', d.length) : tr('av_cmp_same')}</Head>
    {d.map(([k, a, b]) => (
      <div key={k} className="av-row av-prow av-hrow av-cmp">
        <span className="av-in name" title={k}>{k}</span>
        <span className="av-in value was" title={a ?? ''}>{a ?? tr('av_cmp_none')}</span>
        <span className="av-in value" title={b ?? ''}>{b ?? tr('av_cmp_none')}</span>
      </div>
    ))}
  </>)
}

/** The output's folder, missing: make it there, or link a folder elsewhere (under the home folder) to it. */
function OutDir({ id, dir, done }) {
  const [to, setTo] = useState('')
  const [said, setSaid] = useState('')
  const go = async (what) => {
    try { setSaid(''); done(await fixOutDir(id, what)); window.dispatchEvent(new CustomEvent('lilak_flow:ran', { detail: { id } })) }
    catch (e) { setSaid(e.message) }
  }
  return (<>
    <div className="av-row av-finfo"><span className={`av-fok ${dir.exists ? 'ok' : 'bad'}`}>{dir.exists ? '✓' : '✗'}</span>
      <span className="av-in av-fpath">{dir.path}/</span><span className="av-fsz">{dir.exists ? tr('av_dir_ok') : tr('av_dir_none')}</span></div>
    {!dir.exists && (
      <div className="av-row av-finfo av-fix">
        <button type="button" className="rl-btn" onClick={() => go({ make: true })}>{tr('av_dir_make')}</button>
        <span className="av-sub">{tr('av_dir_or')}</span>
        <input className="rl-in" value={to} placeholder={tr('av_dir_link_to')} onChange={(e) => setTo(e.target.value)} />
        <button type="button" className="rl-btn" disabled={!to.trim()} onClick={() => go({ link: to.trim() })}>{tr('av_dir_link')}</button>
      </div>
    )}
    {said && <div className="av-say bad">{said}</div>}
  </>)
}

/** An Input or Output File card in the editor: what the board's dry Init found of its files. */
export default function FileInfo({ id, label, role, files }) {
  const [fixed, setFixed] = useState(null)   // the files after a folder was made or linked here
  useEffect(() => setFixed(null), [files])
  const f = fixed || files || {}
  const out = role === 'outputfile'
  return (
    <>
      <div className="av-row av-scope"><span>{label}</span></div>
      {out ? (f.output ? <><Head>{tr('av_file_output')}</Head>
        {f.outdir && <OutDir id={id} dir={f.outdir} done={setFixed} />}
        <RunHeader out={f.output.full || f.output.path} id={id} /></> : <div className="av-say">{tr('av_file_no_output')}</div>) : (<>
        {!!f.inputs?.length && <><Head>{tr('av_file_inputs')}</Head>{f.inputs.map((x, i) => <One key={i} f={x} />)}</>}
        {f.search && (<>
          <Head>{tr('av_file_search', f.search.tag, f.search.run)}</Head>
          {(f.search.dirs || f.search.paths.map((p) => ({ path: p, exists: true }))).map((d) => (
            <div key={d.path} className="av-row av-finfo"><span className={`av-fok ${d.exists ? '' : 'bad'}`} title={d.exists ? '' : tr('av_dir_none')}>{d.exists ? '⌕' : '✗'}</span>
              <span className="av-in av-fpath">{d.path}</span>{!d.exists && <span className="av-fsz">{tr('av_dir_none')}</span>}</div>
          ))}
          {(f.search.files || f.search.found.map((p) => ({ path: p, exists: true }))).map((x) => <One key={x.path} f={x} />)}
          {!f.search.found.length && <div className="av-say bad">{tr('av_file_found_none')}</div>}
        </>)}
        {!f.inputs?.length && !f.search && <div className="av-say">{tr('av_file_no_input')}</div>}
        {f.entries != null && <div className="av-say">{tr('av_file_entries', f.entries)}</div>}
        {!!f.readers?.length && <div className="av-say">{tr('av_file_readers', f.readers.join(', '))}</div>}
        {f.error && <div className="av-say bad">{f.error}</div>}
      </>)}
    </>
  )
}
