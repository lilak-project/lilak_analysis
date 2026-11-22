// The parameter editor's row operations, checked. Run: node src-lilak/rows.check.mjs
import assert from 'node:assert/strict'
import { keyed, bare, insert, remove, move, toggle, fromFile, flip, copyOf, newPar, isOff, grouped, partsOf, valueOf, flagsOf, docOf } from './rows.js'

const rows = keyed(['a', 'b', 'c', 'd', 'e'].map((name) => ({ ...newPar('G'), name })))
const names = (rs) => rs.map((r) => r.name).join('')
const pick = (...ns) => new Set(rows.filter((r) => ns.includes(r.name)).map((r) => r._k))

assert.equal(names(move(rows, pick('b', 'c'), -1)), 'bcade')
assert.equal(names(move(rows, pick('b', 'c'), 1)), 'adbce')
assert.equal(names(move(rows, pick('a'), -1)), 'abcde', 'the first stays first')
assert.equal(names(move(rows, pick('a', 'b'), -1)), 'abcde', 'a block at the top does not shuffle')
assert.equal(names(move(rows, pick('b', 'd'), 'top')), 'bdace')
assert.equal(names(move(rows, pick('b', 'd'), 'end')), 'acebd')
assert.equal(names(remove(rows, pick('a', 'e'))), 'bcd')
assert.equal(names(insert(rows, pick('b'), [{ ...newPar(), name: 'X' }])), 'abXcde')
assert.equal(names(insert(rows, new Set(), [{ ...newPar(), name: 'X' }])), 'abcdeX')
assert.deepEqual(copyOf(rows, pick('c')).map((r) => r._k), [undefined], 'a copy carries no key')

const flagged = keyed([{ ...newPar('G'), name: 'f', unit: '*', flags: { temporary: true } }, { ...newPar('G'), name: 'g' }])
const all = new Set(flagged.map((r) => r._k))
const off = toggle(flagged, all)
assert.ok(off.every(isOff) && off[0].unit === '*', 'out: every one, the flag kept')
assert.ok(toggle(off, all).every((r) => !isOff(r) && r.enabled === true), 'in again, since all were out')
assert.deepEqual(fromFile([{ ...newPar('G'), unit: '#', flags: { include: true } }]).map((r) => [r.enabled, r.unit]), [[false, '<']], "LILAK's #< held as off + <")
assert.equal(flip(flip({ unit: '' })).unit, '', 'include on and off again')
assert.equal(flip({ unit: '@' }).unit, '', 'another flag goes')
assert.equal(toggle(keyed([{ kind: 'comment', comment: 'x' }]), new Set([flagged[0]._k]))[0].unit, undefined)
assert.equal(bare(rows)[0]._k, undefined)

const mixed = keyed([{ ...newPar('A'), name: '1' }, { kind: 'comment', comment: 'c' }, { ...newPar('B'), name: '2' }, { ...newPar('A'), name: '3' }, { ...newPar(''), name: '4' }])
assert.deepEqual(grouped(mixed).map((g) => [g.name, g.rows.map((r) => r.name || 'c').join('')]), [['A', '13'], ['#', 'c'], ['B', '2'], ['', '4']])
assert.deepEqual(partsOf('  1   2 3 '), ['1', '2', '3'])
assert.deepEqual(partsOf(''), [])
assert.equal(valueOf(['1', '2']), '1  2')
assert.equal(flagsOf('*@'), 'temporary, conditional')
assert.ok(docOf('LKRun').endsWith('classLKRun.html') && docOf('lilak') === '' && docOf('') === '')
console.log('rows: ok')
{
  const { splitPath, condText, withConds, withPlain } = await import('./rows.js')
  assert.deepEqual(splitPath('group/?run==8000'), { conds: ['run==8000'], plain: 'group' })
  assert.deepEqual(splitPath('?{LKRun/RunID}==8000/LKRun'), { conds: ['{LKRun/RunID}==8000'], plain: 'LKRun' }, '/ inside {} stays')
  assert.deepEqual(splitPath('?name=="a/b"/G'), { conds: ['name=="a/b"'], plain: 'G' }, '/ inside quotes stays')
  assert.equal(condText('-run'), '')
  assert.equal(withConds('group/?run==8000', 'run==8001 ?10<x<15'), '?run==8001/?10<x<15/group')
  assert.equal(withConds('?run==8000/G', ''), 'G', 'conditions cleared')
  assert.equal(withPlain('?run==8000/G', 'H/I'), '?run==8000/H/I')
  console.log('paths: ok')
}
{
  const { grouped, keyed, newPar } = await import('./rows.js')
  const g = grouped(keyed([{ ...newPar('?run==1/G'), name: 'a' }, { ...newPar('G'), name: 'b' }, { ...newPar('?run==2'), name: 'c' }]))
  assert.deepEqual(g.map((x) => [x.name, x.rows.length]), [['G', 2], ['', 1]], 'grouped without conditions')
  console.log('grouped by plain: ok')
}
{
  const { withConds, condText } = await import('./rows.js')
  assert.equal(withConds('-run_type', '!run_type'), '?!run_type/-run_type', '?!name, the @- replacement')
  assert.equal(condText('?!run_type/run_type'), '!run_type')
  console.log('?!: ok')
}
