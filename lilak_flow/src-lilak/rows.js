/**
 * What the parameter editor does to a file's rows — pure, so
 * `node src-lilak/rows.check.mjs` can hold it to its word. A row is LILAK's:
 * { kind: 'parameter' | 'comment', group, name, value, unit, comment, enabled }.
 * `unit` is the line's prefix flag (* @ & < !); commented out is `enabled: false`, so a
 * commented-out line keeps its flag (LILAK reads `#<x` as unit `#`: `fromFile` turns it).
 * Every row here also wears `_k`, a key that lasts while the tab is open.
 */
let next = 1
export const keyed = (rows) => rows.map((r) => ({ ...r, _k: r._k || next++ }))
export const bare = (rows) => rows.map(({ _k, ...r }) => r)

const CHAR = { rewrite: '!', temporary: '*', multiple: '&', conditional: '@', include: '<' }
/** A file's rows as the editor holds them: LILAK's unit `#` becomes enabled false plus the flag it hid. */
export const fromFile = (rows) => rows.map((r) => (r.kind === 'parameter' && r.unit === '#'
  ? { ...r, enabled: false, unit: Object.keys(CHAR).filter((k) => r.flags?.[k]).map((k) => CHAR[k]).join('') } : r))
export const isOff = (r) => r.kind === 'parameter' && (r.enabled === false || r.unit === '#')
/** The include flag on or off; a line with some other flag loses it (the button shows which). */
export const flip = (r) => ({ ...r, unit: r.unit ? '' : '<' })
export const newPar = (group = '') => ({ kind: 'parameter', enabled: true, group, name: '', value: '', unit: '', comment: '' })
export const newComment = () => ({ kind: 'comment', enabled: false, group: '', name: '', value: '', unit: '', comment: '' })

const at = (rows, picked) => rows.map((r, i) => (picked.has(r._k) ? i : -1)).filter((i) => i >= 0)

/** Put new rows after the last picked one (or at the end). */
export function insert(rows, picked, made) {
  const idx = at(rows, picked)
  const i = idx.length ? idx[idx.length - 1] + 1 : rows.length
  return [...rows.slice(0, i), ...keyed(made), ...rows.slice(i)]
}

export const remove = (rows, picked) => rows.filter((r) => !picked.has(r._k))

/** Move the picked rows one place (dir −1 / +1), or all the way ('top' / 'end'), keeping their order. */
export function move(rows, picked, dir) {
  const hit = rows.filter((r) => picked.has(r._k)), rest = rows.filter((r) => !picked.has(r._k))
  if (!hit.length) return rows
  if (dir === 'top') return [...hit, ...rest]
  if (dir === 'end') return [...rest, ...hit]
  const out = [...rows]
  const order = dir < 0 ? at(rows, picked) : at(rows, picked).reverse()
  for (const i of order) {
    const j = i + dir
    if (j < 0 || j >= out.length || picked.has(out[j]._k)) continue
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** Comment the picked parameters out, or back in if every one of them is out already. The flag stays. */
export function toggle(rows, picked) {
  const pars = rows.filter((r) => picked.has(r._k) && r.kind === 'parameter')
  const allOff = pars.length > 0 && pars.every(isOff)
  return rows.map((r) => (picked.has(r._k) && r.kind === 'parameter'
    ? { ...r, enabled: allOff, unit: r.unit === '#' ? '' : r.unit } : r))
}

export const edit = (rows, k, patch) => rows.map((r) => (r._k === k ? { ...r, ...patch } : r))
export const copyOf = (rows, picked) => bare(rows.filter((r) => picked.has(r._k)))

/** The old editor's group view: every row under its group's name, wherever it sits in the file. */
export function grouped(rows) {
  const groups = [], at = new Map()
  for (const r of rows) {
    // By the group without its ?… conditions (those are a column): editing one does not move the row.
    const g = r.kind === 'comment' ? '#' : splitPath(r.group).plain
    if (!at.has(g)) { at.set(g, groups.length); groups.push({ name: g, rows: [] }) }
    groups[at.get(g)].rows.push(r)
  }
  return groups
}

/** A value as its space-separated parts (the rich view), and back. */
export const partsOf = (value) => (String(value || '').trim() ? String(value).trim().split(/\s+/) : [])
export const valueOf = (parts) => parts.join('  ')

/** What a line's prefix says, in words. */
const FLAGS = { '!': 'rewrite', '*': 'temporary', '&': 'multiple', '@': 'conditional', '<': 'include', '#': 'commented out' }
export const flagsOf = (unit) => [...String(unit || '')].map((c) => FLAGS[c] || c).join(', ')

/** LILAK's class reference, for a group that is a class name. */
export const docOf = (group) => (/^[A-Z]\w+$/.test(group) ? `https://lilak-project.github.io/lilak_doxygen/class${group}.html` : '')

/** A group path's `?…` condition segments apart from the plain group. LILAK splits a path at
 *  `/` except inside {…} and "…", so this does too. `group/?run==8000` → conds ['run==8000'], plain 'group'. */
export function splitPath(group) {
  const segs = []
  let cur = '', depth = 0, quote = false
  for (const c of String(group || '')) {
    if (c === '"') quote = !quote
    else if (!quote && c === '{') depth += 1
    else if (!quote && c === '}') depth -= 1
    if (c === '/' && !depth && !quote) { segs.push(cur); cur = '' } else cur += c
  }
  segs.push(cur)
  const conds = segs.filter((s) => s.startsWith('?')).map((s) => s.slice(1))
  return { conds, plain: segs.filter((s) => s && !s.startsWith('?')).join('/') }
}
/** Back to a path: the conditions first (LILAK drops them from the name wherever they stand). */
export const joinPath = (conds, plain) => [...conds.filter(Boolean).map((c) => `?${c}`), plain].filter(Boolean).join('/')
/** The condition cell: the segments a space apart (a name holds no spaces), and back. */
export const condText = (group) => splitPath(group).conds.join(' ')
export const withConds = (group, text) => joinPath(text.split(/\s+/).filter(Boolean).map((c) => c.replace(/^\?/, '')), splitPath(group).plain)
export const withPlain = (group, plain) => joinPath(splitPath(group).conds, plain)

/** The run's classes are its `lilak/add` lines: a task is added after the last one (or at the
 *  end), and removed by taking out its lines. Its own parameters stay in the file. */
const isAdd = (r) => r.kind === 'parameter' && r.group === 'lilak' && r.name === 'add' && !isOff(r)
export function addTask(rows, cls) {
  const i = rows.findLastIndex(isAdd)
  const at = i >= 0 ? i + 1 : rows.length
  return [...rows.slice(0, at), { ...newPar('lilak'), name: 'add', value: cls }, ...rows.slice(at)]
}
export const dropTask = (rows, cls) => rows.filter((r) => !(isAdd(r) && String(r.value || '').trim() === cls))

/** The guide's result on a file's rows: `set` { 'LKRun/Name': [values] } puts each name's values where its
 *  first line was (commented out or not), switched on, the rest of its lines gone; a name the file does not
 *  have yet goes after the group's last line. `off` [names] comments their lines out (kept, not deleted). */
export function applyGuide(rows, set = {}, off = []) {
  const key = (r) => r.kind === 'parameter' && `${r.group}/${r.name}`
  let out = rows.map((r) => (off.includes(key(r)) && !isOff(r) ? { ...r, enabled: false } : r))
  for (const [k, vs] of Object.entries(set)) {
    const [group, name] = [k.slice(0, k.lastIndexOf('/')), k.slice(k.lastIndexOf('/') + 1)]
    const made = vs.map((v) => ({ ...newPar(group), name, value: String(v), comment: '' }))
    const i = out.findIndex((r) => key(r) === k)
    if (i >= 0) {
      const keepComment = out[i].comment || ''
      if (made.length) made[0].comment = keepComment
      out = [...out.slice(0, i), ...made, ...out.slice(i + 1).filter((r) => key(r) !== k)]
    } else {
      const last = out.map((r) => r.kind === 'parameter' && r.group === group).lastIndexOf(true)
      const at = last >= 0 ? last + 1 : out.length
      out = [...out.slice(0, at), ...made, ...out.slice(at)]
    }
  }
  return out
}
