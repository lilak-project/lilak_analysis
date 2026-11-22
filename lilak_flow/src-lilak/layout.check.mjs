// A flow's cards and lines, checked. Run: node src-lilak/layout.check.mjs
import assert from 'node:assert/strict'
import { flowLayout, ROW } from './layout.js'

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
const { nodes, edges, width } = flowLayout(model)
const node = (id) => nodes.find((n) => n.id === id)
const line = (id) => edges.find((e) => e.id === id)
const band = (id) => node(id).position.y

// Four bands top down: parameters, input, run, output. No detectors here: no Detector System.
assert.equal(node('detsys'), undefined)
assert.equal(band('pc'), 0)
assert.ok(band('pc') < band('input_file') && band('input_file') < band('run') && band('run') < band('output_file'))
assert.equal(band('in'), band('input_file'), 'an input branch sits beside the input file')
assert.equal(band('T'), band('run'), 'tasks sit beside run')
assert.equal(band('out'), band('output_file'))
assert.equal(node('input_file').data.empty, true)

// Edge to edge: the next card starts on the last one's border.
assert.equal(node('T').position.x - node('run').position.x, 231)
assert.equal(node('out').position.x, 231)
assert.equal(width, 463)
// A band is as tall as its tallest card, plus a row for the lines: run's band holds a task (head + 3 ports).
assert.equal(band('output_file') - band('run'), 4 * ROW + ROW)

// Only data lines, one each even when LILAK lists one twice.
assert.equal(line('in:use→T:input').animated, true)
assert.equal(line('T:register→out:register').animated, true)
assert.equal(line('T:register→out:register').type, 'step', 'right-angle lines')
assert.equal(edges.filter((e) => e.source === 'T' && e.target === 'out').length, 1)
assert.equal(edges.length, 2)

// Detectors get their system card after the parameters.
const d = flowLayout({ nodes: [...model.nodes, { id: 'D', kind: 'class', class_kind: 'detector', label: 'D' }] })
assert.deepEqual(d.nodes.filter((n) => n.position.y === 0).map((n) => n.id), ['pc', 'detsys', 'D'])

assert.deepEqual(flowLayout(null), { nodes: [], edges: [], width: 0 })
console.log('layout: ok')
