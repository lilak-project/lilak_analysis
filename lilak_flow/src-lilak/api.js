// lilak_flow's own API: the files are the records, so the list is not rackstore's.
import { PORTAL_BASE, authHeaders, linkProject } from 'racklist'

async function ask(path, init) {
  const r = await fetch(`${PORTAL_BASE}/api/flow/${path}`, { ...init,
    headers: { ...authHeaders(), ...(init?.body ? { 'Content-Type': 'application/json' } : {}) } })
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
export const loadGraph = async (id) => (await ask(`graph?id=${encodeURIComponent(id)}`)).body

/** Where a `<` line's file is: { state: found|missing|unknown|empty, path?, id? (openable) }. Asked once per value. */
const includes = new Map()
export function findInclude(id, value) {
  const k = `${id}\n${value}`
  if (!includes.has(k)) includes.set(k, ask(`include?id=${encodeURIComponent(id)}&value=${encodeURIComponent(value)}`).then((r) => r.body).catch(() => ({ state: 'unknown' })))
  return includes.get(k)
}

/** A job on jobboard, as the person at the screen: jobrun checks the recipe, the file and the project. */
export async function submitJob(recipe, params, project) {
  const proj = linkProject('jobboard') || 'jobboard'
  const r = await fetch(`/pp/jobboard/${proj}/api/submit`, { method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipe, params, project, server: 'local' }) })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(body.detail || `${r.status}`)
  return { ...body, proj }
}

/** A new parameter file: { project, folder, name } and what goes in it (rows, text, ids, template). */
export const newFile = async (what) => (await ask('new', { method: 'POST', body: JSON.stringify(what) })).body

// What the list holds now, for the new-file form to offer: project → its folders.
let known = new Map()
export const knownPlaces = () => known
export function remember(flows) {
  known = new Map()
  for (const f of flows || []) {
    if (!known.has(f.project)) known.set(f.project, new Set())
    if (f.folder) known.get(f.project).add(f.path.split('/').slice(f.project === 'lilak' ? 0 : 1, -1).join('/'))
  }
}
