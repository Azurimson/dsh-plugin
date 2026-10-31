// test/persona-test.mjs — 人格参数网实测
// 运行：node test/persona-test.mjs
import assert from 'node:assert'
import {
  DEFAULT_PERSONA,
  mergePersona,
  loadPersona,
  setPersonaPath,
  suggestPersonaDeltas,
} from '../src/persona.js'

let passed = 0
let failed = 0
function check(name, fn) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failed++
    console.log(`  ✗ ${name}`)
    console.log(`    ${err?.message ?? err}`)
  }
}

console.log('dsh-human-memory 人格参数网实测\n')

check('默认人格参数齐备', () => {
  assert(DEFAULT_PERSONA.attention && DEFAULT_PERSONA.retrieval)
  assert.strictEqual(DEFAULT_PERSONA.interpretation.logic, 0.5)
  assert.strictEqual(DEFAULT_PERSONA.retrieval.episodic, 1)
})

check('merge 覆盖且裁剪到 [0,2]', () => {
  const p = mergePersona(DEFAULT_PERSONA, { interpretation: { logic: 3 }, retrieval: { episodic: 0.2 } })
  assert.strictEqual(p.interpretation.logic, 2)
  assert.strictEqual(p.retrieval.episodic, 0.2)
  assert.strictEqual(p.attention.person, 1)
})

check('loadPersona 先 settings 后 file（file 优先）', () => {
  const p = loadPersona({ persona: { expression: { verbosity: 0.8 } } }, { expression: { verbosity: 0.3 } })
  assert.strictEqual(p.expression.verbosity, 0.3)
})

check('setPersonaPath 写入合法路径', () => {
  const p = mergePersona(DEFAULT_PERSONA, {})
  assert.strictEqual(setPersonaPath(p, 'interpretation.logic', 0.9), true)
  assert.strictEqual(p.interpretation.logic, 0.9)
  assert.strictEqual(setPersonaPath(p, 'nope.x', 1), false)
})

check('反馈推导参数增量', () => {
  const deltas = suggestPersonaDeltas([
    { trait: 'logic', direction: 'increase' },
    { trait: 'logic', direction: 'increase' },
  ])
  assert(deltas['interpretation.logic'] > 0)
})

check('未知 trait 不产生增量', () => {
  const deltas = suggestPersonaDeltas([{ trait: 'whatever', direction: 'increase' }])
  assert.strictEqual(Object.keys(deltas).length, 0)
})

console.log(`\n结果：${passed} 通过，${failed} 失败`)
process.exit(failed ? 1 : 0)
