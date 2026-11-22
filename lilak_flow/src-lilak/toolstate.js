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
