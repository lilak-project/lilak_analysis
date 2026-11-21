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

// Files locked for viewing only (the lock button in the editor's top bar), kept across visits.
const LOCK_KEY = 'lilak_flow.locked'
let locked = new Set(load(LOCK_KEY, []))
const lockSeen = new Set()
export function toggleLock(id) {
  locked = new Set(locked); locked.has(id) ? locked.delete(id) : locked.add(id)
  save(LOCK_KEY, [...locked]); lockSeen.forEach((f) => f())
}
export const useLocked = (id) => useSyncExternalStore((f) => { lockSeen.add(f); return () => lockSeen.delete(f) }, () => locked.has(id))
