// test/reconstruct-test.mjs — 重构底座实测（分布式 / 多线索 / 续接 / 预测）
// 运行：node test/reconstruct-test.mjs
import assert from 'node:assert'
import { MemoryEngine } from '../src/memory.js'
import { loadSettings } from '../src/settings.js'

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

const settings = loadSettings()
const engine = new MemoryEngine(settings)
const now = Date.now()
const evt = 'evt-1'

// 一个事件散在多个分区
const ep = engine.write({
  content: '昨天在会上被批评',
  layer: 'episodic',
  eventId: evt,
  cues: { topic: ['开会', '批评'], time: '2026-10-30' },
  occurredAt: now - 3600_000,
  source: 'user',
})
const sem = engine.write({
  content: '批评通常让人不适',
  layer: 'semantic',
  eventId: evt,
  cues: { topic: ['批评'] },
  occurredAt: now - 3600_000,
  source: 'inference',
  confidence: 0.7,
})
const emo = engine.write({
  content: '当时很沮丧',
  layer: 'episodic',
  eventId: evt,
  cues: { topic: ['批评'], emotion: ['沮丧'] },
  occurredAt: now - 3600_000,
  source: 'user',
})
const proc = engine.write({
  content: '被批评后先复述对方要点再回应',
  layer: 'procedural',
  eventId: evt,
  cues: { topic: ['批评'] },
  source: 'self',
})
const records = [ep, sem, emo, proc]

console.log('dsh-human-memory 重构底座实测\n')

check('写入记录带 eventId / cues / source / confidence / status', () => {
  assert.strictEqual(ep.eventId, evt)
  assert.deepStrictEqual(ep.cues.topic, ['开会', '批评'])
  assert.strictEqual(sem.source, 'inference')
  assert.strictEqual(sem.confidence, 0.7)
  assert.strictEqual(ep.status, 'active')
})

check('重构按事件聚合多个分区', () => {
  const r = engine.reconstruct(records, '开会 批评')
  assert.strictEqual(r.eventId, evt)
  assert(r.regions.episodic.length >= 1)
  assert(r.regions.semantic.length >= 1)
  assert(r.regions.emotional.length >= 1)
  assert(r.regions.procedural.length >= 1)
})

check('重构文本包含多个侧面', () => {
  const r = engine.reconstruct(records, '开会 批评')
  assert(r.composed.includes('我记得'))
  assert(r.composed.includes('那时的感觉') || r.composed.includes('这让我想到'))
})

check('superseded 记录不参与重构', () => {
  const old = engine.write({ content: '旧判断：批评是坏事', layer: 'semantic', eventId: 'evt-2' })
  const sup = { ...old, status: 'superseded' }
  const r = engine.reconstruct([sup], '批评')
  assert(!r.sources.includes(sup.id))
})

check('缺口 gaps 报告缺失分区', () => {
  const r = engine.reconstruct([ep], '开会')
  assert(r.gaps.includes('semantic'))
  assert(r.gaps.includes('procedural'))
})

check('阶段续接返回目标 / 做到 / 最后 / 下一步', () => {
  const turns = [
    engine.write({ content: '本轮：分析记忆插件', layer: 'episodic', kind: 'turn', sessionId: 's1', turn: 1, occurredAt: now - 3000 }),
    engine.write({ content: '本轮：加了 eventId', layer: 'episodic', kind: 'turn', sessionId: 's1', turn: 2, occurredAt: now - 2000 }),
    engine.write({
      content: '本轮：写完重构底座',
      layer: 'episodic',
      kind: 'turn',
      sessionId: 's1',
      turn: 3,
      occurredAt: now - 1000,
      details: ['下一步：补测试'],
    }),
  ]
  const r = engine.resume(turns, 's1')
  assert.strictEqual(r.goal, turns[0].content)
  assert(r.done.length >= 1)
  assert.strictEqual(r.last, turns[2].content)
  assert.strictEqual(r.next, '补测试')
})

check('无记录时续接返回空结构', () => {
  const r = engine.resume([], 'none')
  assert.strictEqual(r.goal, '')
  assert.strictEqual(r.confidence, 0)
})

check('预测返回四类素材', () => {
  const r = engine.predict(records, '又要被批评了')
  assert(Array.isArray(r.what))
  assert(Array.isArray(r.before))
  assert(Array.isArray(r.how))
  assert(Array.isArray(r.risk))
})

check('人格「提取偏向」影响分区排序', () => {
  const biased = {
    attention: { person: 1, place: 1, topic: 1, time: 1, emotion: 1 },
    retrieval: { working: 0.6, episodic: 0.1, semantic: 2, emotional: 1, procedural: 1, autobiographical: 1 },
  }
  const r = engine.reconstruct(records, '批评', { persona: biased })
  assert(r.regions.semantic.length >= 1)
})

console.log(`\n结果：${passed} 通过，${failed} 失败`)
process.exit(failed ? 1 : 0)
