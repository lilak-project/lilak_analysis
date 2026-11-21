// node src-lilak/history.check.mjs — the record's rule, without the frame (note is pure).
import assert from 'node:assert/strict'
const KEEP = 5, SPELL_MS = 60_000
const { note } = await import('data:text/javascript,' + encodeURIComponent(
  (await import('node:fs')).readFileSync(new URL('./history.js', import.meta.url), 'utf8')
    .replace(/^import .*$/m, '')))
const s = (at, text) => ({ at, text })
let l = note([], s(0, 'a'))
assert.deepEqual(l.map((x) => x.text), ['a'], 'the first is the opened file')
l = note(l, s(1000, 'b'))
assert.deepEqual(l.map((x) => x.text), ['a', 'b'], 'the first is never replaced')
l = note(l, s(2000, 'c'))
assert.deepEqual(l.map((x) => x.text), ['a', 'c'], 'within a spell: the last replaced')
assert.equal(note(l, s(3000, 'c')), l, 'nothing new: unchanged')
for (const [i, t] of ['d', 'e', 'f', 'g', 'h'].entries()) l = note(l, s(2000 + (i + 1) * SPELL_MS, t))
assert.equal(l.length, KEEP)
assert.deepEqual(l.map((x) => x.text), ['a', 'e', 'f', 'g', 'h'], 'five at most, the first kept')
console.log('history: ok')
