/**
 * LILAK's flow graph → the cards and lines of a flow map. Pure, no React, so
 * `node src-lilak/layout.check.mjs` can hold it to its word.
 *
 *            ┌─────── Run ───────┐        Parameter Container left of Run
 *   [detectors] [inputs] [tasks] [output]
 *
 * Everything is measured in rack rows: a card is its rows times ROW high, so no
 * height has to be read back from the page.
 */
export const ROW = 26
export const NODE_W = 232
const GAP = 8, PAD = 12, REGION_GAP = 56, RUN_GAP = 44, PARAM_GAP = 56
const REGION_TOP = ROW + GAP

const REGIONS = [['rg_det', 'detectors'], ['rg_in', 'inputs'], ['rg_tasks', 'tasks'], ['rg_out', 'output']]
const HEADS = [['run-detectors', 'detsys'], ['run-inputs', 'input_file'], ['run-tasks', 'taskmaster'], ['run-output', 'output_file']]
const RANK = { master: 0, inputfile: 0, outputfile: 0, inbranch: 2, detector: 1, task: 1, outbranch: 3 }
const HEADED = new Set(['master', 'inputfile', 'outputfile'])

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
  if (!raw.length) return { nodes: [], edges: [] }
  const members = { rg_det: [], rg_in: [], rg_tasks: [], rg_out: [] }
  let run = null, param = null
  for (const n of raw) {
    const role = roleOf(n)
    if (role === 'run') run = n
    else if (role === 'parambox') param = n
    else if (role === 'detector') members.rg_det.push({ n, role })
    else if (role === 'task') members.rg_tasks.push({ n, role })
    else if (role === 'outputfile' || role === 'outbranch') members.rg_out.push({ n, role })
    else members.rg_in.push({ n, role })
  }
  // Heads LILAK's model has no node for: what the lines from Run land on.
  if (members.rg_det.length) {
    members.rg_det.unshift({ role: 'master', n: { id: 'detsys', kind: 'class', class_kind: 'detector', label: 'Detector System' } })
  }
  if (members.rg_tasks.length) {
    members.rg_tasks.unshift({ role: 'master', n: { id: 'taskmaster', kind: 'class', class_kind: 'task', label: 'Tasks' } })
  }
  if (!members.rg_in.some((m) => m.role === 'inputfile')) {
    members.rg_in.unshift({ role: 'inputfile', n: { id: 'input_file', kind: 'input_file', label: 'Input File', empty: true } })
  }
  for (const g of Object.values(members)) g.sort((a, b) => (RANK[a.role] - RANK[b.role]) || ((a.n.y || 0) - (b.n.y || 0)))

  const nodes = [], roles = {}
  const regionY = (run || param) ? ROW * 2 + RUN_GAP : 0
  let x = 0, boardH = 0
  for (const [gid, label] of REGIONS) {
    const g = members[gid]
    if (!g.length) continue
    let y = REGION_TOP
    const placed = g.map((m) => {
      const at = y
      y += rowsOf(m.role, m.n) * ROW + GAP
      return [m, at]
    })
    const w = NODE_W + PAD * 2, h = y - GAP + PAD
    nodes.push({ id: gid, type: 'region', position: { x, y: regionY }, data: { label }, style: { width: w, height: h },
      draggable: false, selectable: false, zIndex: -1 })
    for (const [m, at] of placed) {
      roles[m.n.id] = m.role
      nodes.push({ id: m.n.id, type: 'lilak', parentId: gid, extent: 'parent', position: { x: PAD, y: at }, data: { ...m.n, role: m.role } })
    }
    x += w + REGION_GAP
    boardH = Math.max(boardH, h)
  }
  const width = Math.max(x - REGION_GAP, 0)
  let runX = 0
  if (run) {
    runX = Math.max((width - NODE_W) / 2, param ? NODE_W + PARAM_GAP : 0)
    roles[run.id] = 'run'
    nodes.push({ id: run.id, type: 'lilak', position: { x: runX, y: 0 }, data: { ...run, role: 'run' } })
  }
  if (param) {
    roles[param.id] = 'parambox'
    nodes.push({ id: param.id, type: 'lilak', position: { x: runX - NODE_W - PARAM_GAP, y: 0 }, data: { ...param, role: 'parambox' } })
  }

  const edges = []
  const add = (source, sourceHandle, target, targetHandle, flow) => edges.push({
    id: `${source}:${sourceHandle}→${target}:${targetHandle}`, source, sourceHandle, target, targetHandle,
    type: 'bezier', animated: flow === 'moving', ...(flow === 'static' ? { className: 'av-static' } : {}) })
  const inputEmpty = members.rg_in.some((m) => m.role === 'inputfile' && m.n.empty)
  if (run) {
    for (const [handle, head] of HEADS) {
      if (roles[head] != null) add(run.id, handle, head, 'top', head === 'input_file' && inputEmpty ? 'static' : undefined)
    }
    if (param) add(run.id, 'param', param.id, 'pcin')
  }
  for (const g of Object.values(members)) {
    g.slice(0, -1).forEach((m, i) => add(m.n.id, HEADED.has(m.role) ? 'chain' : 'chainbot', g[i + 1].n.id, 'chaintop'))
  }
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
  return { nodes, edges }
}
