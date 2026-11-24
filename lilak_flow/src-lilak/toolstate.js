// Which file's toolbox is open: the button in the editor's top bar and the
// parameter pane below it are drawn apart by the kit, so they meet here.
import { useSyncExternalStore } from 'react'
import { load, save } from 'racklist'

const KEY = 'lilak_flow.par.tool'
let open = load(KEY, 'info')          // the open tool's id, '' for shut — one for every file, as in note
const seen = new Set()

export const toolNow = () => open
export function setTool(t) {
  if (t) save(`${KEY}.was`, t)
  open = t
  save(KEY, t)
  seen.forEach((f) => f())
}
export const toggleTool = () => setTool(open ? '' : load(`${KEY}.was`, 'info'))
export const useTool = () => useSyncExternalStore((f) => { seen.add(f); return () => seen.delete(f) }, toolNow)

// Every file opens locked (view only); the lock button in the editor's top bar unlocks it.
// The unlock lasts until the page reloads: the next visit starts locked again.
let unlocked = new Set()
const lockSeen = new Set()
export function toggleLock(id) {
  unlocked = new Set(unlocked); unlocked.has(id) ? unlocked.delete(id) : unlocked.add(id)
  lockSeen.forEach((f) => f())
}
export const useLocked = (id) => useSyncExternalStore((f) => { lockSeen.add(f); return () => lockSeen.delete(f) }, () => !unlocked.has(id))

// Compact: only group, name and value — no checkbox, number, # < ? squares or comments.
// One for every file, kept across visits.
const CKEY = 'lilak_flow.par.compact'
let compact = !!load(CKEY, false)
const compactSeen = new Set()
export function toggleCompact() { compact = !compact; save(CKEY, compact); compactSeen.forEach((f) => f()) }
export const useCompact = () => useSyncExternalStore((f) => { compactSeen.add(f); return () => compactSeen.delete(f) }, () => compact)

// The flow board's picked card narrows its file's editor to that card's groups
// (Run: lilak and LKRun, a task: its own); null shows every row. Per file, not kept.
let scopes = {}
const scopeSeen = new Set()
export function setScope(id, scope) { scopes = { ...scopes, [id]: scope }; scopeSeen.forEach((f) => f()) }
export const useScope = (id) => useSyncExternalStore((f) => { scopeSeen.add(f); return () => scopeSeen.delete(f) }, () => scopes[id] || null)
export const isLocked = (id) => !unlocked.has(id)

// The e{…} values typed on a board's e{…} card, for its Init: per file, kept across visits.
const EKEY = 'lilak_flow.env'
let envs = load(EKEY, {}) || {}
const envSeen = new Set()
export function setEnv(id, name, value) {
  envs = { ...envs, [id]: { ...(envs[id] || {}), [name]: value } }
  save(EKEY, envs); envSeen.forEach((f) => f())
}
export const envOf = (id) => envs[id] || {}
export const useEnv = (id) => useSyncExternalStore((f) => { envSeen.add(f); return () => envSeen.delete(f) }, () => envs[id] || NONE)
const NONE = {}

// The parameter editor's size (text and cells together, as a zoom), from the view tool. One for
// every file, kept. 0.9 is the default: a step under the kit's own size.
export const SIZES = [0.75, 0.8, 0.9, 1, 1.1, 1.25]
const ZKEY = 'lilak_flow.par.size'
let size = SIZES.includes(load(ZKEY, 0.9)) ? load(ZKEY, 0.9) : 0.9
const sizeSeen = new Set()
export function stepSize(d) {
  size = SIZES[Math.min(SIZES.length - 1, Math.max(0, SIZES.indexOf(size) + d))]
  save(ZKEY, size); sizeSeen.forEach((f) => f())
}
export const useSize = () => useSyncExternalStore((f) => { sizeSeen.add(f); return () => sizeSeen.delete(f) }, () => size)

// Each file's values after the board's dry Init: { "group/name": [value, …] }, read by its editor.
let inits = {}
const initSeen = new Set()
export function setInit(id, pars) {
  const m = {}
  for (const [k, v] of pars || []) (m[k] ||= []).push(v)
  inits = { ...inits, [id]: m }
  initSeen.forEach((f) => f())
}
export const useInit = (id) => useSyncExternalStore((f) => { initSeen.add(f); return () => initSeen.delete(f) }, () => inits[id] || NONE)

// Files changed since their last good Init: Run waits until Init passes again (memory only).
let stale = new Set()
const staleSeen = new Set()
export function setStale(id, on) {
  if (stale.has(id) === !!on) return
  stale = new Set(stale); on ? stale.add(id) : stale.delete(id)
  staleSeen.forEach((f) => f())
}
export const useStale = (id) => useSyncExternalStore((f) => { staleSeen.add(f); return () => staleSeen.delete(f) }, () => stale.has(id))

// A try to change a locked file (a key in a cell, a press on a mark): its unlock button blinks.
let tries = {}
const trySeen = new Set()
export function tryLocked(id) { tries = { ...tries, [id]: (tries[id] || 0) + 1 }; trySeen.forEach((f) => f()) }
export const useLockTries = (id) => useSyncExternalStore((f) => { trySeen.add(f); return () => trySeen.delete(f) }, () => tries[id] || 0)

// Each file's Run button as RunLog has it ({ off, title, label, sure }), for a copy of it (the Init values tab).
let runStates = {}
const runSeen = new Set()
export function setRunState(id, st) { runStates = { ...runStates, [id]: st }; runSeen.forEach((f) => f()) }
export const useRunState = (id) => useSyncExternalStore((f) => { runSeen.add(f); return () => runSeen.delete(f) }, () => runStates[id] || null)
