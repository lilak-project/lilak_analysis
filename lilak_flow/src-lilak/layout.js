/**
 * LILAK's flow graph → the cards and lines of a flow map. Pure, no React, so
 * `node src-lilak/layout.check.mjs` can hold it to its word.
 *
 * Four bands, top down, like a table; the cards of a band sit edge to edge:
 *   [Parameter Container][Detector System][detector]…
 *   [Input File][input branch]…
 *   [Run][task]…
 *   [Output File][output branch]…
 * Lines are only the data: a branch a task reads, a branch a task writes.
 *
 * Everything is measured in rack rows: a card is its rows times ROW high, so no
 * height has to be read back from the page.
 */
export const ROW = 26
export const NODE_W = 232
const BAND_GAP = ROW                      // room for the lines between bands

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

/** A card's port rows, under its head and subtitle: [left port, right port]. */
export function portRows(role) {
  if (role === 'task') return [['input', 'register'], ['', 'keep'], ['', 'get']]
  if (role === 'outbranch') return [['register', ''], ['keep', ''], ['get', '']]
  return role === 'inbranch' ? [['', 'use']] : []
}
const rowsOf = (role, n) => 1 + (role !== 'task' && n.subtitle ? 1 : 0) + portRows(role).length

export function flowLayout(model) {
  const raw = model?.nodes || []
  if (!raw.length) return { nodes: [], edges: [], width: 0 }
  const by = { run: [], parambox: [], detector: [], inputfile: [], inbranch: [], task: [], outputfile: [], outbranch: [] }
  for (const n of raw) by[roleOf(n)].push(n)
  for (const g of Object.values(by)) g.sort((a, b) => (a.y || 0) - (b.y || 0))
  const card = (role, n) => ({ role, n })
  const bands = [
    [...by.parambox.map((n) => card('parambox', n)),
      ...(by.detector.length ? [card('master', { id: 'detsys', kind: 'class', class_kind: 'detector', label: 'Detector System' })] : []),
      ...by.detector.map((n) => card('detector', n))],
    [...(by.inputfile.length ? by.inputfile.map((n) => card('inputfile', n))
      : [card('inputfile', { id: 'input_file', kind: 'input_file', label: 'Input File', empty: true })]),
      ...by.inbranch.map((n) => card('inbranch', n))],
    [...by.run.map((n) => card('run', n)), ...by.task.map((n) => card('task', n))],
    [...(by.outputfile.length ? by.outputfile.map((n) => card('outputfile', n))
      : [card('outputfile', { id: 'output_file', kind: 'output_file', label: 'Output File', empty: true })]),
      ...by.outbranch.map((n) => card('outbranch', n))],
  ]

  const nodes = [], roles = {}
  let y = 0, width = 0
  for (const band of bands) {
    if (!band.length) continue
    let x = 0, h = 0
    for (const { role, n } of band) {
      roles[n.id] = role
      nodes.push({ id: n.id, type: 'lilak', position: { x, y }, data: { ...n, role } })
      x += NODE_W - 1                     // shared border
      h = Math.max(h, rowsOf(role, n) * ROW)
    }
    width = Math.max(width, x + 1)
    y += h + BAND_GAP
  }

  const edges = []
  const add = (source, sourceHandle, target, targetHandle, flow) => edges.push({
    id: `${source}:${sourceHandle}→${target}:${targetHandle}`, source, sourceHandle, target, targetHandle,
    type: 'step', animated: flow === 'moving', ...(flow === 'static' ? { className: 'av-static' } : {}) })
  // Who reads and writes which branch, from each class's own record.
  const branches = new Map(raw.filter((n) => n.kind === 'branch').map((n) => [`${n.branch_name}::${n.branch_class_name}`, n]))
  const seen = new Set()
  for (const n of raw) {
    if (n.kind !== 'class') continue
    const cd = model.class_data?.[n.class_name || n.label]
    if (!cd) continue
    const wire = (entry, action) => {
      const b = branches.get(`${entry.branch_name || ''}::${entry.class_name || ''}`)
      const key = b && `${n.id}|${b.id}|${action}`
      if (!b || seen.has(key)) return
      seen.add(key)
      if (roles[b.id] === 'inbranch') add(b.id, 'use', n.id, 'input', 'moving')
      else add(n.id, action, b.id, action, action === 'register' ? 'moving' : 'static')
    }
    for (const u of cd.uses || []) wire(u, u.action === 'keep' ? 'keep' : 'get')
    for (const s of cd.saves || []) wire(s, s.action === 'keep' ? 'keep' : 'register')
  }
  return { nodes, edges, width }
}
