/**
 * LILAK's flow graph → the cards and lines of a flow map. Pure, no React, so
 * `node src-lilak/layout.check.mjs` can hold it to its word.
 *
 * Four columns, left to right, like a table drawn at its real size and scrolled;
 * the cards of a column stand one under the other, apart:
 *   Parameter Container   Input File     Run    Output File
 *   Detector System       input branch   task   output branch
 *   detector …            …              …      …
 * Data lines — a branch a task reads, a branch a task writes — run from one column to the
 * next on its right, through the gap between them. Short chain lines join the cards of the
 * input, run and output columns one under the other.
 *
 * Everything is measured in rack rows: a card is its rows times ROW high, so no
 * height has to be read back from the page.
 */
import { splitPath } from './rows.js'

export const ROW = 22                     // a board row: smaller than a list's, the board is a map
export const NODE_W = 232                 // a card at its widest
export const MIN_W = 120                  // narrower than this, it scrolls instead
export const COL_GAP = 32                 // gap between columns: lines go down it
export const PAD = 16                     // around the table
const LANE = 6                            // lines in one gap stand this far apart, closer if many
const LANE_EDGE = 5                       // no lane nearer a card than this
const CARD_GAP = 8                        // between one card and the next: no two cards touch

/** A branch is an input of the macro, or something the tasks write. */
const isInput = (n) => n.kind === 'branch' && !n.persist_disabled && n.style === 'branch_input'

export function roleOf(n) {
  if (n.kind === 'run') return 'run'
  if (n.kind === 'input_file') return 'inputfile'
  if (n.kind === 'output_file') return 'outputfile'
  if (n.kind === 'branch') return isInput(n) ? 'inbranch' : 'outbranch'
  if (n.kind === 'class') return n.class_kind === 'detector' ? 'detector' : 'task'
  return 'parambox'
}

/** A card's port rows, under its head and subtitle: [left port, right port]. With `n.used` (the
 *  ports a line reaches, `L:name`/`R:name`, set by flowLayout) only those rows show; a task's input
 *  shares keep's row, since keeping a branch is holding on to what came in. */
export function portRows(role, n = {}) {
  if (role === 'inputfile') return n.files?.readers?.length ? [['', 'source']] : []
  const u = n.used
  if (role === 'task') {
    if (!u) return [['input', 'register'], ['', 'keep'], ['', 'get']]
    const rows = ['register', 'keep', 'get'].filter((p) => u.has(`R:${p}`)).map((p) => ['', p])
    if (u.has('L:input')) {
      const at = rows.find(([, p]) => p === 'keep') || rows[0]
      if (at) at[0] = 'input'
      else rows.push(['input', ''])
    }
    return rows
  }
  if (role === 'outbranch') return ['register', 'keep', 'get'].filter((p) => !u || u.has(`L:${p}`)).map((p) => [p, ''])
  return role === 'inbranch' && (!u || u.has('R:use')) ? [['', 'use']] : []
}
/** The class a card's doc, header and source belong to; none for the others. */
export function classOf(role, n) {
  if (role === 'run') return 'LKRun'
  if (role === 'task' || role === 'detector') return n.class_name || n.label
  if (role === 'inbranch' || role === 'outbranch') return n.branch_class_name || ''
  return ''
}
/** The row under a card's head: its class (Run: its name and number). The picked card shows
 *  its doc, header and source buttons in the same row, so picking moves nothing. */
export const subText = (role, n) => (role === 'run' ? withEnv(n.subtitle, n.env) : /file$/.test(role) && n.files ? fileText(role, n.files)
  : classOf(role, n) || n.subtitle) || ''

/** LILAK's e{NAME} and e{NAME:-default} (LKParameterContainer): a set, non-empty value, else the default. */
export const withEnv = (s, env = {}) => String(s ?? '').replace(/e\{([A-Za-z_]\w*)(?::-([^}]*))?\}/g,
  (_, k, d) => (d == null ? env[k] ?? '' : env[k] || d))

/** What the graph's dry Init says of the run's files (backend files_of): the input it opened, or
 *  its mfm search, with the entries; the output it would write, and whether one is there already. */
const base = (p) => String(p || '').split('/').pop()
export function fileText(role, f) {
  if (role === 'outputfile') return f.output ? `→ ${base(f.output.path)}` : ''   // there or not: its own row (statOf)
  const ev = f.entries ? ` · ${f.entries} ev` : ''
  if (f.search) return `${f.search.tag} run ${f.search.run} · ${f.search.found.length} files${ev}`
  if (f.inputs.length) return `${f.inputs.every((i) => i.exists) ? '✓' : '✗'} ${base(f.inputs[0].path)}${f.inputs.length > 1 ? ` +${f.inputs.length - 1}` : ''}${ev}`
  return f.error ? `✗ ${f.error}` : ''
}
/** The full list, for the card's tooltip. */
export function fileTip(role, f) {
  if (!f) return ''
  if (role === 'outputfile') return [f.output?.path, f.outdir && !f.outdir.exists && `✗ missing folder: ${f.outdir.path}`].filter(Boolean).join('\n')
  const found = f.search ? [`${f.search.tag} run ${f.search.run} in`, ...(f.search.dirs || f.search.paths.map((p) => ({ path: p, exists: true }))).map((d) => `  ${d.exists ? '' : '✗ missing: '}${d.path}`), ...f.search.found] : []
  return [...found, ...f.inputs.map((i) => `${i.exists ? '✓' : '✗ missing:'} ${i.path}`), f.error].filter(Boolean).join('\n')
}
/** No input where the run needs one: the card says so. */
export const fileBad = (role, f) => !!f && (role === 'inputfile' ? !!inBad(f) : role === 'outputfile' && !!outBad(f))
// A search that found files is fine though one of its folders is not there (LILAK finds in the others):
// that folder shows ✗ in the editor, the card is not red for it.
const inBad = (f) => f.inputs.some((i) => !i.exists) || !!f.error || (f.search && !f.search.found.length)
/** Inputs found (an mfm search with files, or every input there): the card's line in green, as information. */
export const fileOk = (role, f) => role === 'inputfile' && !!f && !inBad(f) && (!!f.search?.found.length || f.inputs.length > 0)
const outBad = (f) => f.outdir && !f.outdir.exists
/** Why a Run may not start (an i18n key), or '': an input or input folder missing, or the output's folder. */
export const runBlock = (f) => (!f ? '' : inBad(f) ? 'av_block_input' : outBad(f) ? 'av_block_outdir' : '')
const subOf = (role, n) => (subText(role, n) ? 1 : 0)
/** Rows under the head for the subtitle or, picked, the buttons: kept the same either way, so a card never grows. */
export const slotOf = (role, n) => Math.max(subOf(role, n), actsOf(role, n).length ? actRows(role, n).length : 0) + statOf(role)
/** The run's own row under them (the output's too: there, made when, how big): how its last Init or Run went, and how far it got. */
export const statOf = (role) => (role === 'run' || role === 'outputfile' ? 1 : 0)
const rowsOf = (role, n) => 1 + slotOf(role, n) + portRows(role, n).length + (role === 'env' ? n.vars.length : 0)
/** What the picked card offers in its class row: its class's doc, header and source, and what
 *  only it does — the run adds a task, a task (or detector) leaves, the parameters' Init, an include opens. */
export const actsOf = (role, n) => [
  ...(classOf(role, n) ? ['doc', 'h', 'cpp'] : []),
  ...({ run: ['add', 'init', 'exec'], task: ['drop'], detector: ['drop'], include: ['open'] }[role] || []),
]
/** The picked card's button rows: the run's own (+ task, Init) get a second row under doc · header · source. */
export const actRows = (role, n) => {
  const all = actsOf(role, n)
  return role === 'run' && all.length > 3 ? [all.slice(0, 3), all.slice(3)] : [all]
}

/** The file's own parts, under its Parameter Container: a card a `<` include, one for the groups
 *  no other card stands for (Others: Run has lilak, LKRun and persistency, a class its own), and
 *  one for the e{…} the file names, with this server's value. */
export function partsOf(model) {
  const on = (model?.rows || []).filter((r) => r.kind === 'parameter' && r.enabled !== false && r.unit !== '#')
  const inc = (r) => String(r.unit || '').includes('<')
  const owned = new Set(['lilak', 'LKRun', 'persistency',
    ...(model?.nodes || []).filter((n) => n.kind === 'class').map((n) => n.class_name || n.label),
    // and the helpers' groups a class's card holds (LKFrameBuilder, the merger's)
    ...Object.values(model?.helpers || {}).flat()])
  const groups = [...new Set(on.filter((r) => !inc(r)).map((r) => splitPath(r.group).plain))]
    .filter((g) => !owned.has(g.split('/')[0]))
  const vars = Object.keys(model?.env || {})
  return [
    ...on.filter(inc).map((r, i) => ({ id: `include_${i}`, kind: 'include', label: r.name, subtitle: r.value, value: r.value })),
    ...(groups.length ? [{ id: 'others', kind: 'others', label: 'Others', subtitle: groups.map((g) => g || '(no group)').join(', '), groups }] : []),
    ...(vars.length ? [{ id: 'env', kind: 'env', label: 'Environment variables', vars, env: model.env }] : []),
  ]
}
/** A card's height: its rows and its border. */
export const heightOf = (role, n) => rowsOf(role, n) * ROW + 2
/** Where a port sits on the page: the card's edge, the middle of the port's row. */
function portAt(node, name, side) {
  const { role } = node.data
  const i = portRows(role, node.data).findIndex(([l, r]) => (side === 'left' ? l : r) === name)
  return { x: node.position.x + (side === 'left' ? 0 : node.w), y: node.position.y + 1 + (1 + slotOf(role, node.data) + i) * ROW + ROW / 2 }
}

/** `room`: the width the table may take; its cards narrow to fit it, down to MIN_W. */
/** `picked`: the card clicked, whose class row shows its buttons. */
export function flowLayout(model, room = 0, picked = null) {
  const raw = model?.nodes || []
  if (!raw.length) return { nodes: [], edges: [], width: 0, height: 0 }
  const by = { run: [], parambox: [], detector: [], inputfile: [], inbranch: [], task: [], outputfile: [], outbranch: [] }
  const roles = {}
  for (const n of raw) { roles[n.id] = roleOf(n); by[roles[n.id]].push(n) }
  for (const g of Object.values(by)) g.sort((a, b) => (a.y || 0) - (b.y || 0))

  // Who reads and writes which branch, from each class's own record — before any card has a place,
  // since the places follow it.
  const branches = new Map(raw.filter((n) => n.kind === 'branch').map((n) => [`${n.branch_name}::${n.branch_class_name}`, n]))
  // A task may read a branch named by its own parameter (PSA's inputBranchName): LILAK's
  // record cannot see that, so the file's rows say it.
  const named = (cls) => (model.rows || [])
    .filter((r) => r.kind === 'parameter' && r.enabled !== false && r.unit !== '#' && r.group === cls
      && /branch/i.test(r.name || '') && !/output/i.test(r.name || ''))
    .flatMap((r) => String(r.value || '').split(',').map((v) => v.trim()).filter(Boolean))
  const links = [], seen = new Set()
  for (const n of raw) {
    if (n.kind !== 'class') continue
    const cd = model.class_data?.[n.class_name || n.label] || {}
    const wire = (entry, action) => {
      const b = branches.get(`${entry.branch_name || ''}::${entry.class_name || ''}`)
      const key = b && `${n.id}|${b.id}|${action}`
      if (!b || seen.has(key)) return
      seen.add(key)
      if (roles[b.id] === 'inbranch') links.push({ task: n.id, branch: b.id, l: [b.id, 'use', n.id, 'input', 'moving'] })
      else links.push({ task: n.id, branch: b.id, l: [n.id, action, b.id, action, action === 'register' ? 'moving' : 'static'] })
    }
    for (const u of cd.uses || []) wire(u, u.action === 'keep' ? 'keep' : 'get')
    for (const name of named(n.class_name || n.label)) {
      for (const b of branches.values()) if (b.branch_name === name) wire({ branch_name: name, class_name: b.branch_class_name }, 'get')
    }
    for (const s of cd.saves || []) wire(s, s.action === 'keep' ? 'keep' : 'register')
  }
  // The input file itself (an mfm) goes to the tasks that open it.
  // (LILAK draws no input card for an mfm search; the Init found its files, so one stands here.)
  const fin = by.inputfile[0] || (model.files?.search || model.files?.inputs?.length ? { id: 'input_file', kind: 'input_file', label: 'Input File' } : null)
  for (const n of raw) {
    if (fin && n.kind === 'class' && model.files?.readers?.includes(n.class_name)) {
      links.push({ task: n.id, branch: fin.id, l: [fin.id, 'source', n.id, 'input', 'moving'] })
    }
  }
  // The ports a line reaches: only their rows show on the cards.
  const used = new Map()
  const use = (id, p) => { if (!used.has(id)) used.set(id, new Set()); used.get(id).add(p) }
  for (const { l: [a, ap, b, bp] } of links) { use(a, `R:${ap}`); use(b, `L:${bp}`) }
  // A branch column in the order of the tasks that first touch its branches, so each can
  // stand level with its task.
  const first = new Map()
  for (const t of by.task) for (const k of links) if (k.task === t.id && !first.has(k.branch)) first.set(k.branch, first.size)
  for (const g of [by.inbranch, by.outbranch]) g.sort((a, b) => (first.get(a.id) ?? 1e9) - (first.get(b.id) ?? 1e9))

  const card = (role, n) => ({ role, n })
  const columns = [
    [...by.parambox.map((n) => card('parambox', n)),
      ...partsOf(model).map((n) => card(n.kind, n)),
      ...(by.detector.length ? [{ ...card('master', { id: 'detsys', kind: 'class', class_kind: 'detector', label: 'Detector System' }), apart: by.parambox.length ? ROW : 0 }] : []),
      ...by.detector.map((n) => card('detector', n))],
    [...(fin ? [card('inputfile', { ...fin, files: model.files })]
      : [card('inputfile', { id: 'input_file', kind: 'input_file', label: 'Input File', empty: true })]),
      ...by.inbranch.map((n) => card('inbranch', n))],
    [...by.run.map((n) => card('run', { ...n, env: model.env })), ...by.task.map((n) => card('task', n))],
    [...(by.outputfile.length ? by.outputfile.map((n) => card('outputfile', { ...n, files: model.files }))
      : [card('outputfile', { id: 'output_file', kind: 'output_file', label: 'Output File', empty: true })]),
      ...by.outbranch.map((n) => card('outbranch', n))],
  ]

  const cols = columns.filter((c) => c.length).length
  const w = room ? Math.floor(Math.min(NODE_W, Math.max(MIN_W, (room - 2 * PAD - (cols - 1) * COL_GAP) / cols))) : NODE_W
  const nodes = [], at = {}, colOf = {}
  const xs = [], cursor = [], next = []   // per column: its x, the first free y, the next card to place
  let x = PAD
  for (const [ci, column] of columns.entries()) {
    xs[ci] = x; cursor[ci] = PAD; next[ci] = 0
    for (const c of column) colOf[c.n.id] = ci
    if (column.length) x += w + COL_GAP
  }
  const width = x - COL_GAP + PAD
  // Place a column's cards in order up to (and with) card `id`, that one no higher than `y`.
  const placeTo = (ci, id = null, y = 0) => {
    const column = columns[ci]
    while (next[ci] < column.length) {
      const i = next[ci]++, { role, n, apart } = column[i]
      // Further apart: detectors from the parameters, and in a chain the head (file, run) from what is under it.
      let top = cursor[ci] + (apart || (ci > 0 && i === 1 ? ROW : 0))
      if (n.id === id) top = Math.max(top, y)
      const node = { id: n.id, position: { x: xs[ci], y: top }, w, data: { ...n, role, picked: n.id === picked, used: used.get(n.id) || new Set() } }
      nodes.push(node); at[n.id] = node
      cursor[ci] = top + heightOf(role, node.data) + CARD_GAP
      if (n.id === id) return top
    }
    return null
  }
  const free = (ci, i = next[ci]) => cursor[ci] + (ci > 0 && i === 1 ? ROW : 0)
  for (const ci of [0, 1, 2, 3]) if (columns[ci].length) placeTo(ci, columns[ci][0].n.id)
  // Each task level with the first branch it touches that has no place yet; whichever stands
  // higher moves down to the other.
  for (const t of by.task) {
    const b = links.find((k) => k.task === t.id && !at[k.branch])?.branch
    if (!b) { placeTo(2, t.id); continue }
    const cb = colOf[b]
    const ib = columns[cb].findIndex((c) => c.n.id === b)
    while (next[cb] < ib) placeTo(cb, columns[cb][next[cb]].n.id)
    const y = Math.max(free(2), free(cb))
    placeTo(2, t.id, y); placeTo(cb, b, y)
  }
  for (const ci of [0, 1, 2, 3]) placeTo(ci)
  const height = Math.max(...cursor.map((c, ci) => (columns[ci].length ? c - CARD_GAP + PAD : 0)))
  // A column's cards in a chain: the file and its branches, run and its tasks, one under the other.
  const chains = []
  for (const [ci, column] of columns.entries()) {
    if (ci > 0) for (let i = 1; i < column.length; i++) chains.push([at[column[i - 1].n.id], at[column[i].n.id]])
  }

  const edges = []
  // Out of the source's right side, down (or up) the gap to the next column, into the
  // target's left side. The lines of one gap spread across it, each in its own lane.
  const lines = []
  const add = (source, sourceHandle, target, targetHandle, flow) => {
    const a = portAt(at[source], sourceHandle, 'right'), b = portAt(at[target], targetHandle, 'left')
    lines.push({ a, b, e: { id: `${source}:${sourceHandle}→${target}:${targetHandle}`, source, sourceHandle, target, targetHandle,
      animated: flow === 'moving', dashed: flow === 'static' } })
  }
  for (const [a, b] of chains) {
    const cx = a.position.x + a.w / 2   // down the middle of the cards it joins
    edges.push({ id: `${a.id}↓${b.id}`, source: a.id, target: b.id, chain: true,
      d: `M${cx},${a.position.y + heightOf(a.data.role, a.data)}V${b.position.y}` })
  }
  for (const k of links) if (at[k.l[0]] && at[k.l[2]]) add(...k.l)
  // A task that keeps what came in: a line across it, from input to keep (between the labels).
  for (const t of by.task) {
    const node = at[t.id]
    if (!node || !portRows('task', node.data).some(([l, r]) => l === 'input' && r === 'keep')) continue
    const { y } = portAt(node, 'keep', 'right'), x0 = node.position.x
    edges.push({ id: `${t.id}:input→keep`, source: t.id, target: t.id, inner: true, d: `M${x0 + 50},${y}H${x0 + node.w - 46}` })
  }
  const gaps = Map.groupBy(lines, (l) => l.a.x)
  for (const group of gaps.values()) {
    const step = Math.min(LANE, (COL_GAP - 2 * LANE_EDGE) / Math.max(1, group.length - 1))
    group.forEach(({ a, b, e }, i) => {
      const gx = Math.round((a.x + LANE_EDGE + i * step) * 10) / 10
      edges.push({ ...e, d: `M${a.x},${a.y}H${gx}V${b.y}H${b.x}` })
    })
  }
  return { nodes, edges, width, height }
}

// What the board adds to a file's values (its graph prints them): not a parameter the run was made with.
const ADDED = new Set(['lilak/print'])
const byName = (pairs) => {
  const m = new Map()
  for (const [k, v] of pairs) if (!ADDED.has(k)) m.set(k, [...(m.get(k) || []), String(v ?? '').trim()])
  return m
}
/** The names whose values differ between two sets of [[name, value]] (a name given several times:
 *  its values as a set, in any order): [[name, then, now]], `null` where a side has none. */
export function differ(then, now) {
  const a = byName(then), b = byName(now)
  return [...new Set([...a.keys(), ...b.keys()])].filter((k) => [...(a.get(k) || [])].sort().join('\n') !== [...(b.get(k) || [])].sort().join('\n'))
    .map((k) => [k, a.has(k) ? a.get(k).join('\n') : null, b.has(k) ? b.get(k).join('\n') : null])   // several values: a line each
}

