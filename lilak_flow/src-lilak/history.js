/**
 * The file tool's record of this edit tab: the file as it was opened (always kept), then the
 * file as saved at the end of each spell of editing — five at most, the first among them.
 * Kept in memory per file while its edit tab is open (switching tabs keeps it, closing drops
 * it); `node src-lilak/history.check.mjs` holds `note` to its word.
 */
import { load, projectKey } from 'racklist'

export const KEEP = 5
export const SPELL_MS = 60_000   // saves closer together than this are one spell: the later replaces the earlier

/** The list after a save: same as the last → unchanged; within a spell → the last replaced; else added. */
export function note(list, snap) {
  if (!list.length) return [snap]
  const last = list[list.length - 1]
  if (last.text === snap.text) return list
  const next = list.length > 1 && snap.at - last.at < SPELL_MS ? [...list.slice(0, -1), snap] : [...list, snap]
  return next.length > KEEP ? [next[0], ...next.slice(-(KEEP - 1))] : next
}

const kept = new Map()   // file id → [{ at, rows, text }]

// The edit tabs open now, as the rack frame keeps them (null: cannot tell, so keep everything).
function openIds() {
  const p = load(projectKey('av', 'panes'), null)
  return p?.tabs ? new Set(p.tabs.map((t) => String(t.who ?? String(t.id).replace(/^item:/, '')))) : null
}

/** A file's pane came in: start its record with the file as opened, unless its tab already has one. */
export function begin(id, file) {
  if (!kept.has(id)) kept.set(id, [{ at: Date.now(), rows: file.rows, text: file.text }])
}
/** A file's pane went: switching tabs keeps the record; a closed tab drops it. Asked a moment
 *  later, once the frame has written down which tabs are left. */
export function leave(id) {
  setTimeout(() => { const open = openIds(); if (open && !open.has(String(id))) kept.delete(id) }, 300)
}
export const add = (id, file) => kept.set(id, note(kept.get(id) || [], { at: Date.now(), rows: file.rows, text: file.text }))
export const list = (id) => kept.get(id) || []
export const hhmm = (t) => new Date(t).toTimeString().slice(0, 5)
