// A flow's cards and lines, checked. Run: node src-lilak/layout.check.mjs
import assert from 'node:assert/strict'
import { flowLayout, ROW, NODE_W, MIN_W, COL_GAP, PAD } from './layout.js'

const model = {
  nodes: [
    { id: 'run', kind: 'run', label: 'Run', subtitle: 'tebat / 113' },
    { id: 'pc', kind: 'parameter_container', label: 'Parameters' },
    { id: 'in', kind: 'branch', branch_name: 'RawData', branch_class_name: 'LKRaw', style: 'branch_input', label: 'RawData', y: 1 },
    { id: 'out', kind: 'branch', branch_name: 'Hit', branch_class_name: 'LKHit', style: 'branch_output', label: 'Hit', y: 1 },
    { id: 'T', kind: 'class', class_kind: 'task', class_name: 'T', label: 'T', subtitle: 'hidden on a task' },
    { id: 'output_file', kind: 'output_file', label: 'Output', subtitle: 'out.root' },
  ],
  class_data: { T: {
    uses: [{ branch_name: 'RawData', class_name: 'LKRaw' }],
    saves: [{ branch_name: 'Hit', class_name: 'LKHit' }, { branch_name: 'Hit', class_name: 'LKHit' }],
  } },
}
const { nodes, edges: all, width, height } = flowLayout(model)
const edges = all.filter((e) => !e.chain)
const node = (id) => nodes.find((n) => n.id === id)
const line = (id) => edges.find((e) => e.id === id)
const col = (id) => node(id).position.x
const y = (id) => node(id).position.y

// Four columns left to right: parameters, input, run, output. No detectors here: no Detector System.
assert.equal(node('detsys'), undefined)
assert.equal(col('pc'), PAD)
assert.ok(col('pc') < col('input_file') && col('input_file') < col('run') && col('run') < col('output_file'))
assert.equal(col('in'), col('input_file'), 'an input branch stands under the input file')
assert.equal(col('T'), col('run'), 'tasks stand under run')
assert.equal(col('out'), col('output_file'))
assert.equal(node('input_file').data.empty, true)
assert.equal(col('run') - col('input_file'), NODE_W + COL_GAP)

// No two cards touch: the next card starts a gap below the last one.
assert.ok(y('in') - y('input_file') >= ROW + 2 + 8 + ROW, 'a head (file, run) stands a row further from what is under it')
assert.equal(y('in'), y('T'), 'a task stands level with the first branch it touches')
assert.ok(y('out') <= y('T'), 'an output branch no lower than the task that writes it')
assert.equal(y('run'), PAD)
assert.equal(y('T') - y('run'), 4 * ROW + 2 + 8 + ROW, 'run (head + name + its button row kept + its state row), then a row further apart')
assert.equal(width, PAD + 4 * NODE_W + 3 * COL_GAP + PAD)
assert.equal(height, y('T') + 3 * ROW + 2 + PAD, 'the tallest column: run, a gap, its task (head, class, one port row: input with register, the only ones a line reaches)')

// A line leaves the source's port, ends on the target's, turns only at right angles,
// and stands in the gap between the two columns.
const nums = (d) => d.match(/-?[\d.]+/g).map(Number)
const use = line('in:use→T:input')
const [sx, sy, gx, ty, tx] = nums(use.d)
assert.equal(sx, col('in') + NODE_W)
assert.equal(sy, y('in') + 1 + 2 * ROW + ROW / 2, 'the use port: head, class row, then the port')
assert.equal(tx, col('T'))
assert.equal(ty, y('T') + 1 + 2 * ROW + ROW / 2, 'the input port: under the head and the class row')
assert.ok(gx > sx && gx < tx, 'down the gap, not a card')
assert.match(use.d, /^M[\d.]+,[\d.]+H[\d.]+V[\d.]+H[\d.]+$/)

// Only data lines, one each even when LILAK lists one twice.
assert.equal(line('in:use→T:input').animated, true)
assert.equal(line('T:register→out:register').animated, true)
assert.equal(edges.filter((e) => e.source === 'T' && e.target === 'out').length, 1)
assert.equal(edges.length, 2)
const two = flowLayout({ nodes: [...model.nodes, { id: 'U', kind: 'class', class_kind: 'task', label: 'U', y: 9 }] }).nodes
const tn = (id) => two.find((n) => n.id === id)
assert.equal(tn('U').position.y - tn('T').position.y, 2 * ROW + 2 + 8, 'tasks stand apart from each other, closer than from run (no lines here: no port rows)')
assert.notEqual(nums(line('T:register→out:register').d)[2], gx, 'each line its own lane')

// Fit to the room: a half screen (800px) narrows the cards so all four columns show;
// a wide one keeps them at full width; too little room stops at MIN_W and scrolls.
const fit = (room) => flowLayout(model, room)
assert.ok(fit(800).width <= 800, 'four columns in half a screen')
assert.equal(fit(800).nodes[0].w, Math.floor((800 - 2 * PAD - 3 * COL_GAP) / 4))
assert.equal(fit(3000).nodes[0].w, NODE_W)
assert.equal(fit(300).nodes[0].w, MIN_W)
const narrow = fit(800), nn = (id) => narrow.nodes.find((x) => x.id === id)
assert.equal(Number(narrow.edges.find((e) => !e.chain).d.match(/^M([\d.]+)/)[1]), nn('in').position.x + nn('in').w, 'lines follow the narrower cards')

// Chains: each column but the parameters' joins its cards one under the other.
const chain = all.filter((e) => e.chain).map((e) => e.id)
assert.deepEqual(chain, ['input_file↓in', 'run↓T', 'output_file↓out'])
assert.equal(all.find((e) => e.id === 'run↓T').d, `M${col('run') + node('run').w / 2},${y('run') + 4 * ROW + 2}V${y('T')}`, 'down the gap between them')
const withDet = flowLayout({ nodes: [...model.nodes, { id: 'D', kind: 'class', class_kind: 'detector', label: 'D' }] }).edges
assert.equal(withDet.some((e) => e.chain && (e.source === 'pc' || e.source === 'detsys')), false, 'no chain in the parameters column')

// Detectors get their system card after the parameters.
const d = flowLayout({ nodes: [...model.nodes, { id: 'D', kind: 'class', class_kind: 'detector', label: 'D' }] })
assert.deepEqual(d.nodes.filter((n) => n.position.x === PAD).map((n) => n.id), ['pc', 'detsys', 'D'])
const dn = (id) => d.nodes.find((n) => n.id === id)
assert.equal(dn('detsys').position.y - dn('pc').position.y, ROW + 2 + 8 + ROW, 'a row further apart from the parameters (a one-row card here)')
assert.equal(dn('D').position.y - dn('detsys').position.y, ROW + 2 + 8, 'its detectors under it, apart')

assert.deepEqual(flowLayout(null), { nodes: [], edges: [], width: 0, height: 0 })
console.log('layout: ok')

// A task that names the branch it reads in its own parameter (PSA's inputBranchName) reads it,
// though LILAK's record does not say so; an output branch name in a parameter is not a read.
const byPar = flowLayout({ ...model, class_data: {}, rows: [
  { kind: 'parameter', group: 'T', name: 'inputBranchName', value: 'RawData' },
  { kind: 'parameter', group: 'T', name: 'OutputBranchName', value: 'Hit' },
] }).edges.filter((e) => !e.chain).map((e) => e.id)
assert.deepEqual(byPar, ['in:use→T:input'])

// Level, both ways: a later task moves down to its branch, or its branch down to it.
const lv = flowLayout({ nodes: [
  { id: 'run', kind: 'run', label: 'Run' },
  { id: 'A', kind: 'class', class_kind: 'task', label: 'A', y: 1 },
  { id: 'B', kind: 'class', class_kind: 'task', label: 'B', y: 2 },
  { id: 'h', kind: 'branch', branch_name: 'H', branch_class_name: 'K', style: 'branch_output', label: 'H' },
  { id: 'k', kind: 'branch', branch_name: 'J', branch_class_name: 'K', style: 'branch_output', label: 'J' },
], class_data: { A: { saves: [{ branch_name: 'J', class_name: 'K' }, { branch_name: 'H', class_name: 'K' }] },
  B: { saves: [{ branch_name: 'H', class_name: 'K' }] } } }).nodes
const ly = (id) => lv.find((n) => n.id === id).position.y
assert.equal(ly('k'), ly('A'), 'J first: A touches it first')
assert.ok(ly('h') > ly('k'), 'the branch column follows the tasks')
assert.equal(ly('B'), ly('h'), 'B level with H, the first it touches that had no place yet')

// The lines of one gap spread across it: each its own lane, none on a card.
const many = flowLayout({ nodes: [
  { id: 'run', kind: 'run', label: 'Run' },
  { id: 'A', kind: 'class', class_kind: 'task', label: 'A' },
  ...'abcdefgh'.split('').map((c) => ({ id: c, kind: 'branch', branch_name: c, branch_class_name: 'K', style: 'branch_output', label: c })),
], class_data: { A: { saves: 'abcdefgh'.split('').map((c) => ({ branch_name: c, class_name: 'K' })) } } })
const lanes = many.edges.filter((e) => !e.chain).map((e) => nums(e.d)[2])
const ax = many.nodes.find((n) => n.id === 'A'), right = ax.position.x + ax.w
assert.equal(new Set(lanes).size, 8, 'eight lines, eight lanes')
assert.ok(lanes.every((g) => g > right && g < right + COL_GAP), 'all inside the gap')

// Picking a card moves nothing: its buttons take the class row it already has.
const pk = flowLayout(model, 0, 'T'), pn = (id) => pk.nodes.find((n) => n.id === id)
assert.equal(pn('T').data.picked, true)
assert.deepEqual(pk.nodes.map((n) => n.position), nodes.map((n) => n.position))
const pr = flowLayout(model, 0, 'pc')
assert.equal(pr.height, height, 'no buttons, no row: the parameter box has no class')
{
  const { partsOf, flowLayout, actsOf } = await import('./layout.js')
  const P = (group, name, value, unit = '') => ({ kind: 'parameter', enabled: true, group, name, value, unit })
  const model = {
    nodes: [{ id: 'pc', kind: 'parameter_container', label: 'Parameter Container' }, { id: 'run', kind: 'run', label: 'Run' },
      { id: 'T', kind: 'class', class_kind: 'task', label: 'T', class_name: 'T' }],
    rows: [P('', 'conf', 'a.mac', '<'), P('LKRun', 'Name', 'x'), P('persistency', 'Hit', 'true'), P('T', 'a', '1'),
      P('T/sub', 'b', '1'), P('?run==1/Plane', 'c', 'e{DATA}/f'), P('Off', 'd', '1', '#')],
    env: { DATA: '/d' },
  }
  const parts = partsOf(model)
  assert.deepEqual(parts.map((n) => n.kind), ['include', 'others', 'env'])
  assert.deepEqual(parts[1].groups, ['Plane'], 'Others: not run, not a class, conditions dropped, commented out left')
  assert.deepEqual(parts[2].vars, ['DATA'])
  const { nodes } = flowLayout(model)
  const y = (id) => nodes.find((n) => n.id === id).position.y
  assert.ok(y('pc') < y('include_0') && y('include_0') < y('others') && y('others') < y('env'), 'under the container, in order')
  assert.deepEqual(actsOf('task', { class_name: 'T' }), ['doc', 'h', 'cpp', 'drop'])
  assert.deepEqual(actsOf('others', {}), [])
  console.log('parameter parts: ok')
}
{
  const { flowLayout, fileText, fileBad } = await import('./layout.js')
  const files = { inputs: [], search: { tag: 'mfm', run: 421, paths: ['/r'], found: ['/r/run_0421.a', '/r/run_0421.b'] },
    output: { path: '/o/atomx_0421.conv.root', exists: true }, entries: null, error: '', readers: ['LKGETConversionTask'] }
  const model = { nodes: [{ id: 'run', kind: 'run', label: 'Run' }, { id: 'output_file', kind: 'output_file', label: 'Output File' },
    { id: 'C', kind: 'class', class_kind: 'task', label: 'LKGETConversionTask', class_name: 'LKGETConversionTask' }], files }
  const { nodes, edges } = flowLayout(model)
  const inp = nodes.find((n) => n.id === 'input_file')
  assert.ok(inp && !inp.data.empty, 'an mfm search stands as an input card though LILAK draws none')
  assert.ok(edges.some((e) => e.source === 'input_file' && e.sourceHandle === 'source' && e.target === 'C'), 'line to the conversion task')
  assert.equal(fileText('inputfile', files), 'mfm run 421 · 2 files')
  assert.equal(fileText('outputfile', files), '→ atomx_0421.conv.root', 'there or not is its own row')
  assert.ok(!fileBad('inputfile', files) && fileBad('inputfile', { ...files, search: { ...files.search, found: [] } }), 'a search that found nothing is bad')
  assert.equal(fileText('inputfile', { inputs: [{ path: 'd/a.root', exists: false }], entries: 5 }), '✗ a.root · 5 ev')
  console.log('files: ok')
}

// e{…} on a card as LILAK reads it.
{
  const { withEnv } = await import('./layout.js')
  assert.equal(withEnv('atomx / e{RUN:-421}', {}), 'atomx / 421')
  assert.equal(withEnv('atomx / e{RUN:-421}', { RUN: '7' }), 'atomx / 7')
  assert.equal(withEnv('e{RUN:-421}', { RUN: '' }), '421')
  assert.equal(withEnv('a e{X}', {}), 'a ')
  console.log('env: ok')
}

// Picking a card never changes its size: its button rows are reserved.
{
  const { flowLayout: L, heightOf } = await import('./layout.js')
  const a = L(model), b = L(model, 0, 'run')
  const h = (m) => m.nodes.find((n) => n.id === 'run')
  assert.equal(heightOf('run', h(a).data), heightOf('run', h(b).data), 'run the same picked or not')
  console.log('slots: ok')
}

// Only the ports a line reaches show; a task's input shares keep's row, with a line across the card.
{
  const { portRows } = await import('./layout.js')
  assert.deepEqual(portRows('task', { used: new Set(['L:input', 'R:keep', 'R:get']) }), [['input', 'keep'], ['', 'get']])
  assert.deepEqual(portRows('task', { used: new Set(['R:register']) }), [['', 'register']])
  assert.deepEqual(portRows('task', { used: new Set(['L:input']) }), [['input', '']])
  assert.deepEqual(portRows('outbranch', { used: new Set(['L:keep']) }), [['keep', '']])
  const kept = { ...model, class_data: { T: { uses: [{ branch_name: 'RawData', class_name: 'LKRaw' }], saves: [{ branch_name: 'Hit', class_name: 'LKHit', action: 'keep' }] } } }
  const k = flowLayout(kept)
  assert.ok(k.edges.some((e) => e.inner && e.id === 'T:input→keep'), 'input to keep, across the task')
  console.log('ports: ok')
}

// Run waits for its inputs and its output's folder.
{
  const { runBlock, fileBad } = await import('./layout.js')
  const ok = { inputs: [], search: { found: ['a'], paths: ['/d'], dirs: [{ path: '/d', exists: true }] }, outdir: { exists: true } }
  assert.equal(runBlock(ok), '')
  assert.equal(runBlock({ ...ok, search: { ...ok.search, dirs: [{ path: '/d', exists: false }] } }), '', 'a missing folder beside found files is no block')
  assert.equal(runBlock({ ...ok, search: { ...ok.search, found: [] } }), 'av_block_input')
  assert.equal(runBlock({ ...ok, outdir: { exists: false } }), 'av_block_outdir')
  assert.ok(fileBad('outputfile', { ...ok, outdir: { exists: false } }) && !fileBad('outputfile', ok))
  console.log('run block: ok')
}

// An output's parameters against the file's now: a name's several values in any order are the same.
{
  const { differ } = await import('./layout.js')
  const then = [['LKRun/RunID', '421'], ['LKRun/InputPath', 'a'], ['LKRun/InputPath', 'b'], ['X/old', '1']]
  const now = [['LKRun/RunID', '420'], ['LKRun/InputPath', 'b'], ['LKRun/InputPath', 'a'], ['X/new', '2'], ['lilak/print', 'par']]
  assert.deepEqual(differ(then, now), [['LKRun/RunID', '421', '420'], ['X/old', '1', null], ['X/new', null, '2']])
  assert.deepEqual(differ(then, then), [])
  console.log('differ: ok')
}

// A helper's group (LKFrameBuilder, made by the merger) is its task's, not Others'.
{
  const { partsOf } = await import('./layout.js')
  const row = (group, name) => ({ kind: 'parameter', group, name, value: '1', unit: '' })
  const m = { nodes: [{ id: 'T', kind: 'class', class_name: 'LKCoboFrameMergerTask' }], rows: [row('LKFrameBuilder', 'MaxCobo'), row('Mine', 'x')],
    helpers: { LKCoboFrameMergerTask: ['LKFrameBuilder'] } }
  assert.deepEqual(partsOf(m).find((p) => p.id === 'others').groups, ['Mine'])
  console.log('helpers: ok')
}
