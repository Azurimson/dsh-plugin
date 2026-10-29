// test/self-test.mjs — 记忆引擎自测
// 直接测 src/memory.js 的纯逻辑（不依赖 DSH），用来确认核心机制正确。
// 运行：node test/self-test.mjs
import assert from 'node:assert'
import { MemoryEngine, formatDate, parseTime } from '../src/memory.js'
import { loadSettings, stripJsonComments } from '../src/settings.js'

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

console.log('dsh-human-memory 自测\n')

// ---------- 配置加载 ----------
check('JSONC 注释可被正确剥离（保留字符串里的 //）', () => {
  const jsonc = '{\n  "a": 1, // 行注释\n  "b": "http://x",\n  /* 块注释 */ "c": 2\n}'
  const parsed = JSON.parse(stripJsonComments(jsonc))
  assert.strictEqual(parsed.a, 1)
  assert.strictEqual(parsed.b, 'http://x')
  assert.strictEqual(parsed.c, 2)
})

check('settings.json 可加载且六维权重齐备', () => {
  const s = loadSettings()
  for (const k of ['selfRelevance', 'causality', 'concreteness', 'uniqueness', 'emotion', 'dwell']) {
    assert.strictEqual(typeof s.importance[k], 'number', `缺少 importance.${k}`)
  }
})

// ---------- 重要性评分 ----------
const engine = new MemoryEngine(loadSettings())

check('六维全满分 → 重要性 ≈ 1', () => {
  const v = engine.computeImportance({
    selfRelevance: 1, causality: 1, concreteness: 1, uniqueness: 1, emotion: 1, dwell: 1,
  })
  assert(v > 0.99 && v <= 1, `得到 ${v}`)
})

check('零分内容 → 重要性 ≈ 0', () => {
  const v = engine.computeImportance({
    selfRelevance: 0, causality: 0, concreteness: 0, uniqueness: 0, emotion: 0, dwell: 0,
  })
  assert(v < 0.01, `得到 ${v}`)
})

check('记忆时长越长，时长因子越大', () => {
  assert(engine.dwellFactor(600000) > engine.dwellFactor(1000))
})

// ---------- 时间衰减 ----------
check('记忆强度随年龄单调下降（遗忘曲线）', () => {
  const rec = engine.write({ content: '测试：项目用 Python' })
  const s0 = engine.strength(rec, rec.lastAccessedAt)
  const s1 = engine.strength(rec, rec.lastAccessedAt + 86_400_000) // +1 天
  const s2 = engine.strength(rec, rec.lastAccessedAt + 30 * 86_400_000) // +30 天
  assert(s0 > s1 && s1 > s2, `期望 s0>s1>s2，得到 ${s0}, ${s1}, ${s2}`)
  assert(s2 > 0, '强度应始终为正值（只降排名、不归零）')
})

// ---------- 间隔效应 ----------
check('间隔越久，再次提起的加权越高', () => {
  const base = engine.write({ content: '间隔测试内容' })
  const short = engine.reinforce(base, base.lastAccessedAt + 1000)                 // 间隔 1 秒
  const long = engine.reinforce(base, base.lastAccessedAt + 30 * 86_400_000)       // 间隔 30 天
  assert(long.importance > short.importance, `长间隔 ${long.importance} 应 > 短间隔 ${short.importance}`)
})

check('再次提起会重置衰减锚点（曲线回升）', () => {
  const base = engine.write({ content: '锚点测试' })
  const t = base.lastAccessedAt + 1000
  const refreshed = engine.reinforce(base, t)
  assert.strictEqual(refreshed.lastAccessedAt, t)
  assert(refreshed.mentionCount === base.mentionCount + 1)
})

// ---------- 检索 ----------
check('检索把语义相关的那条排在最前', () => {
  const coffee = engine.write({ content: '用户喜欢喝咖啡加糖' })
  const db = engine.write({ content: '项目数据库用 PostgreSQL' })
  const hits = engine.recall([coffee, db], '数据库 PostgreSQL')
  assert.strictEqual(hits[0].id, db.id, `期望 ${db.id} 排第一，实际 ${hits[0].id}`)
})

// ---------- 巩固 ----------
check('两条相似高价值情节记忆 → 合并出语义记忆', () => {
  const a = { ...engine.write({ content: '用户偏好：用 Python 写后端' }), importance: 0.9, accessCount: 3 }
  const b = { ...engine.write({ content: '用户偏好：用 Python 写后端服务' }), importance: 0.9, accessCount: 3 }
  const res = engine.consolidate([a, b], Date.now())
  assert(res.created >= 1, `应新建语义记忆，实际 created=${res.created}`)
  assert(res.result.some((m) => m.layer === 'semantic'), '结果里应有 semantic 层')
})

// ---------- 复习 ----------
check('年久未用的记忆会进入待复习列表', () => {
  const weak = engine.write({ content: '很旧的一条弱记忆' })
  weak.lastAccessedAt = Date.now() - 365 * 86_400_000 // 一年前
  const due = engine.dueForReview([weak], Date.now())
  assert(due.some((m) => m.id === weak.id), '应判定为需要复习')
})

// ---------- 事件日期 ----------
check('写入时记录事件发生时间 occurredAt', () => {
  const t = new Date(2026, 0, 15, 9, 30).getTime()
  const rec = engine.write({ content: '发生于某天的事件', occurredAt: t })
  assert.strictEqual(rec.occurredAt, t)
})

check('重复写入保留最早的发生时间', () => {
  const t1 = new Date(2026, 0, 15).getTime()
  const t2 = new Date(2026, 1, 20).getTime()
  const first = engine.write({ content: '同一事件被再次提起', occurredAt: t1 })
  const again = engine.write({ content: '同一事件被再次提起', occurredAt: t2 }, first)
  assert.strictEqual(again.occurredAt, t1)
})

check('formatDate 输出可读日期', () => {
  const t = new Date(2026, 0, 15, 9, 5).getTime()
  assert.strictEqual(formatDate(t), '2026-01-15 09:05')
})

check('parseTime 支持 ISO / 纯日期 / epoch', () => {
  assert.strictEqual(parseTime('2026-01-15'), new Date(2026, 0, 15).getTime())
  assert.strictEqual(parseTime(1_700_000_000_000), 1_700_000_000_000)
  assert(parseTime('2026-01-15T09:30:00+08:00') > 0)
  assert.strictEqual(parseTime('不是时间'), null)
})

check('recall 结果带 occurredAt', () => {
  const t = new Date(2026, 2, 1).getTime()
  const rec = engine.write({ content: '带日期的记忆', occurredAt: t })
  const hits = engine.recall([rec], '带日期')
  assert.strictEqual(hits[0].occurredAt, t)
})

console.log(`\n结果：${passed} 通过，${failed} 失败`)
process.exit(failed ? 1 : 0)
