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
const { nodes, edges } = flowLayout(model)
const node = (id) => nodes.find((n) => n.id === id)
const line = (id) => edges.find((e) => e.id === id)

// Regions are only made for what exists; an empty input slot still appears.
assert.deepEqual(nodes.filter((n) => n.type === 'region').map((n) => n.id), ['rg_in', 'rg_tasks', 'rg_out'])
assert.equal(node('input_file').data.empty, true)
assert.equal(node('taskmaster').parentId, 'rg_tasks')

// A task hides its subtitle: head + 3 ports. The next card starts after them.
assert.equal(node('T').position.y - node('taskmaster').position.y, ROW + 8)
assert.equal(node('output_file').position.y < node('out').position.y, true, 'the file heads its region')
assert.equal(node('rg_tasks').style.height, ROW + 8 + ROW + 8 + 4 * ROW + 12)

// Data lines, one each even when LILAK lists one twice.
assert.equal(line('in:use→T:input').animated, true)
assert.equal(line('T:register→out:register').animated, true)
assert.equal(edges.filter((e) => e.source === 'T' && e.target === 'out').length, 1)
assert.equal(line('run:param→pc:pcin').type, 'bezier')
assert.equal(line('run:run-inputs→input_file:top').className, 'av-static', 'nothing to read yet')

assert.deepEqual(flowLayout(null), { nodes: [], edges: [] })
console.log('layout: ok')
