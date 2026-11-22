// node src-lilak/tree.check.mjs
import assert from 'node:assert/strict'
import { treeOf, allDirs } from './tree.js'
const t = treeOf([{ path: 'stark/m2/b.mac', name: 'b' }, { path: 'stark/m1/a.mac', name: 'a' }, { path: 'top.mac', name: 'top' }, { path: 'stark/m1/c.mac', name: 'c' }])
assert.equal(t.count, 4)
assert.deepEqual(t.files.map((f) => f.name), ['top'], 'a file at the root stays at the root')
assert.deepEqual(t.dirs.map((d) => [d.path, d.count]), [['stark', 3]])
assert.deepEqual(t.dirs[0].dirs.map((d) => [d.path, d.count, d.files.map((f) => f.name)]), [['stark/m1', 2, ['a', 'c']], ['stark/m2', 1, ['b']]], 'sorted, counted')
assert.deepEqual(allDirs(t), ['stark', 'stark/m1', 'stark/m2'])
console.log('tree: ok')
