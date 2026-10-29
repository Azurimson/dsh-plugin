// test/consolidate-test.mjs — 巩固（consolidation）实测
// 直接测 src/memory.js 的 consolidate：高价值相似情节记忆合并为语义记忆、归档源记忆，
// 并验证「权重（重要性）」如何变化。运行：node test/consolidate-test.mjs
import assert from 'node:assert'
import { MemoryEngine } from '../src/memory.js'
import { loadSettings } from '../src/settings.js'

const engine = new MemoryEngine(loadSettings())
const now = Date.now()

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

function rec(id, content, { importance = 0.5, access = 0 } = {}) {
  return {
    id,
    content,
    layer: 'episodic',
    kind: 'fact',
    createdAt: now,
    occurredAt: now,
    lastAccessedAt: now,
    accessCount: access,
    mentionCount: 0,
    reviewHistory: [now],
    importance,
    factors: {},
    dwellMs: 0,
    archived: false,
  }
}

// 3 条相似、高价值 + 1 条不相似高价值 + 1 条低价值
const a = rec('a', '用户偏好：用 Python 写后端服务', { importance: 0.9, access: 3 })
const b = rec('b', '用户偏好：后端服务用 Python', { importance: 0.9, access: 3 })
const c = rec('c', '用户偏好：Python 写后端', { importance: 0.9, access: 3 })
const d = rec('d', '项目数据库使用 PostgreSQL 17', { importance: 0.9, access: 3 })
const e = rec('e', '今天天气不错', { importance: 0.1, access: 0 })
const before = [a, b, c, d, e]

console.log('dsh-human-memory 巩固实测\n')
console.log('输入：')
for (const m of before) {
  console.log(`  - ${m.id}  重要性=${m.importance.toFixed(2)} 访问=${m.accessCount}  ${m.content}`)
}

const res = engine.consolidate(before, now)

console.log('\n输出：')
for (const m of res.result) {
  const tag = m.layer === 'semantic' ? '语义' : m.archived ? '已归档' : '保留'
  console.log(`  - ${m.id}  [${tag}]  重要性=${Number(m.importance).toFixed(2)}  ${m.content}`)
}
console.log(`\n扫描高价值情节记忆 ${res.merged} 条，新建语义记忆 ${res.created} 条\n`)

check('只合并相似组（created = 1）', () => assert.strictEqual(res.created, 1))
check('扫描到 4 条高价值情节记忆（低价值被跳过）', () => assert.strictEqual(res.merged, 4))

const semantic = res.result.find((m) => m.layer === 'semantic')
check('生成一条语义记忆', () => assert(semantic))
check('语义记忆内容合并了原信息', () => assert(semantic.content.includes('Python')))

const byId = Object.fromEntries(res.result.map((m) => [m.id, m]))
check('相似组的三条源记忆被归档', () => {
  for (const id of ['a', 'b', 'c']) assert.strictEqual(byId[id].archived, true, `${id} 应归档`)
})
check('不相似的高价值记忆不归档', () => assert.strictEqual(byId['d'].archived, false))
check('低价值记忆原样保留', () => {
  assert.strictEqual(byId['e'].archived, false)
  assert.strictEqual(byId['e'].importance, 0.1)
})
check('语义记忆继承组内最高重要性（0.9）', () => assert.strictEqual(semantic.importance, 0.9))
check('归档记忆不再出现在常规召回', () => {
  const hits = engine.recall(res.result, 'Python 后端', 10)
  assert(hits.every((h) => !['a', 'b', 'c'].includes(h.id)), '归档的 a/b/c 不应被召回')
  assert(hits.some((h) => h.id === semantic.id), '应召回到语义记忆')
})

// 再跑一次应幂等：没有新的相似组可合并
const res2 = engine.consolidate(res.result, now)
check('再次巩固不会重复合并（created = 0）', () => assert.strictEqual(res2.created, 0))

console.log(`\n结果：${passed} 通过，${failed} 失败`)
process.exit(failed ? 1 : 0)
