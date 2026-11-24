// lilak_flow's own API: the files are the records, so the list is not rackstore's.
import { PORTAL_BASE, authHeaders, linkProject } from 'racklist'
import { currentLang } from 'lilak-ui/i18n.jsx'

async function ask(path, init) {
  const url = `${PORTAL_BASE}/api/flow/${path}`
  // ?lang= too: the portal's proxy does not pass X-Lang on.
  const r = await fetch(`${url}${url.includes('?') ? '&' : '?'}lang=${currentLang()}`, { ...init,
    // X-Lang: the server's messages for a person come back in the page's language.
    headers: { ...authHeaders(), 'X-Lang': currentLang(), ...(init?.body ? { 'Content-Type': 'application/json' } : {}) } })
  const body = await r.json().catch(() => ({}))
  if (!r.ok && r.status !== 409) throw new Error(body.detail || `${r.status}`)
  return { status: r.status, body }
}

export async function loadItems() {
  const { body } = await ask('items')
  remember(body.flows)
  return body
}

/** Only what the page may change about a file goes back: its tags and its note. */
export async function saveItems(next, doc) {
  const flows = (next.flows || []).map((f) => ({ id: f.id, tags: f.tags || [], note: f.note || '' }))
  const { status, body } = await ask('items', { method: 'PUT', body: JSON.stringify({ version: doc.version, flows }) })
  return status === 409 ? { conflict: true, doc: body } : { doc: body }
}

export const loadFile = async (id) => (await ask(`file?id=${encodeURIComponent(id)}`)).body
/** { file } saved, or { conflict, file } with the file as it is on disk now. */
export async function saveFile(id, version, what) {
  const { status, body } = await ask('file', { method: 'PUT', body: JSON.stringify({ id, version, ...what }) })
  return status === 409 ? { conflict: true, file: body } : { file: body }
}
export const restoreFile = async (id) => (await ask('restore', { method: 'POST', body: JSON.stringify({ id }) })).body
export const convert = async (what) => (await ask('convert', { method: 'POST', body: JSON.stringify(what) })).body
/** LILAK's graph of a file. Kept once drawn: going back to its tab draws it at once instead of
 *  asking LILAK again (which re-reads the file and, with an input file, opens it in ROOT).
 *  `fresh` asks again — the reload button, or after a save. */
const graphs = new Map()
/** `again`: ask the server once more (its kept graph, with the files as they are now), not this page's copy. */
export function loadGraph(id, fresh = false, again = false) {
  if (fresh || again || !graphs.has(id)) {
    const p = ask(`graph?id=${encodeURIComponent(id)}${fresh ? '&fresh=1' : ''}`).then((r) => r.body)
    graphs.set(id, p)
    p.catch(() => graphs.delete(id))              // a failure is asked again next time
  }
  return graphs.get(id)
}

/** Where a `<` line's file is: { state: found|missing|unknown|empty, path?, id? (openable) }. Asked once per value. */
const includes = new Map()
export function findInclude(id, value) {
  const k = `${id}\n${value}`
  if (!includes.has(k)) includes.set(k, ask(`include?id=${encodeURIComponent(id)}&value=${encodeURIComponent(value)}`).then((r) => r.body).catch(() => ({ state: 'unknown' })))
  return includes.get(k)
}

/** A job on jobboard, as the person at the screen: jobrun checks the recipe, the file and the project. */
/** Init or run the file here, in the background: { rid }; then its state until done. */
export const execStart = async (id, mode) => {
  const { status, body } = await ask('exec', { method: 'POST', body: JSON.stringify({ id, mode }) })
  if (status === 409) throw new Error(body.detail || '409')
  return body
}
export const execState = async (rid) => (await ask(`exec/${rid}`)).body

/** The set's logbook (its linked project): a log written, or one changed, by the person at the page. */
export const logbookProject = () => linkProject('logbook')
async function logbook(path, payload) {
  const r = await fetch(`/pp/logbook/${logbookProject()}/api/${path}`, { method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(body.detail || `logbook ${r.status}`)
  return body.record
}
/** These values as a set of the set's parameters service (an existing one with the same values
 *  answers instead): the address a logbook log's Parameters field stores. */
export async function registerPars(text, title) {
  const proj = linkProject('parameters')
  if (!proj) return null
  const r = await fetch(`/pp/parameters/${proj}/api/register?format=lilak-par&origin=auto&title=${encodeURIComponent(title)}`, {
    method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'text/plain' }, body: text })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(body.detail || `parameters ${r.status}`)
  return { svc: 'parameters', proj, id: body.record.id }
}
export const addLog = (record) => logbook('records', { key: 'logs', record })
export const updateLog = (id, fields) => logbook('records/update', { key: 'logs', id, fields })

/** A new parameter file: { project, folder, name } and what goes in it (rows, text, ids, template). */
export const newFile = async (what) => (await ask('new', { method: 'POST', body: JSON.stringify(what) })).body

// What the list holds now, for the new-file form to offer: project → its folders.
let known = new Map()
export const knownPlaces = () => known
/** LILAK's own files and its shared ones: not offered for new files, not in the folders tab. */
export const HIDDEN = new Set(['lilak', 'common', 'examples'])
/** The root a file is in (`lilak`, `scratch`), from its id. */
export const rootOf = (f) => String(f?.id || '').split(':')[0]
/** A file's folder inside its project (a root's own project, lilak's macros or scratch, has no folder of its own). */
export const folderOf = (f) => f.path.split('/').slice(f.project === rootOf(f) ? 0 : 1, -1).join('/')
export function remember(flows) {
  known = new Map([['scratch', new Set()]])   // the shared scratch folder is a place, empty or not
  for (const f of flows || []) {
    if (!known.has(f.project)) known.set(f.project, new Set())
    if (f.folder) known.get(f.project).add(folderOf(f))
  }
}

/** A class's header (`h`) or source (`cpp`), read only: { path, text }. */
export const loadCode = async (cls, kind) => (await ask(`code?cls=${encodeURIComponent(cls)}&kind=${kind}`)).body

/** What `lilak/add` can take: { tasks, detectors }, asked once a page. */
let kinds = null
const classPars = new Map()
/** What class `cls` can take: [{ name, value, comment, from: template|source }] (kept per page). */
/** The RunHeader LILAK wrote with this output ({ file, log, rows: [[key, value]] }). */
export const loadRunHeader = async (out) => (await ask(`runheader?out=${encodeURIComponent(out)}`)).body

/** The parameters an output file was made with ({ pars: [[name, value]], error }). */
export const loadOutPars = async (out) => (await ask(`outpars?out=${encodeURIComponent(out)}`)).body

/** The output's missing folder: { make: true } or { link: folder }. The run's files after. */
export const fixOutDir = async (id, what) => (await ask('outdir', { method: 'POST', body: JSON.stringify({ id, ...what }) })).body

/** Are these there, as a run of file `id` reads them: { files, dirs } → each { path, full, exists, size, mtime }. */
export const checkPaths = async (id, what) => (await ask('check', { method: 'POST', body: JSON.stringify({ id, ...what }) })).body
/** What a SearchRun would find: { tag, paths, runs, name } → { runs: { run: [files] }, dirs }. */
export const searchCheck = async (id, what) => (await ask('searchcheck', { method: 'POST', body: JSON.stringify({ id, ...what }) })).body

/** One folder through the rack's browsing route (its folders and files; in the allowed folders only). */
export const listDir = async (path) => (await ask(`../browse?path=${encodeURIComponent(path)}`)).body

export const loadClassPars = (cls) => {
  if (!classPars.has(cls)) classPars.set(cls, ask(`classpars?cls=${encodeURIComponent(cls)}`).then((r) => r.body.pars || []))
  return classPars.get(cls)
}
export const loadClasses = () => (kinds ||= ask('classes').then((r) => r.body).catch((e) => { kinds = null; throw e }))
/** The file's parameters after a dry Init: { pars: [[key, value]], returncode, tail }. */
export const loadInit = async (id, env) => (await ask('init', { method: 'POST', body: JSON.stringify({ id, env }) })).body
