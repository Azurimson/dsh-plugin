// test/db-test.mjs — node:sqlite 记忆索引实测
// 运行：node test/db-test.mjs
import assert from 'node:assert'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryIndex } from '../src/index-db.js'

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

const dir = mkdtempSync(join(tmpdir(), 'dsh-hm-db-'))
const db = new MemoryIndex(join(dir, 'memory.sqlite'))

function rec(id, occurredAt, extra = {}) {
  return {
    id,
    content: id,
    layer: 'episodic',
    kind: 'fact',
    fidelity: 'gist',
    sessionId: 's1',
    occurredAt,
    importance: 0.5,
    emotionKind: 'neutral',
    emotionIntensity: 0,
    details: [],
    ...extra,
  }
}

console.log('dsh-human-memory 数据库索引实测\n')

try {
  check('索引可用（node:sqlite）', () => assert.strictEqual(db.available, true))

  db.upsert(rec('a', 1000), 'memories/episodic/a.json')
  db.upsert(rec('b', 2000), 'memories/episodic/b.json')
  db.upsert(rec('c', 3000, { fidelity: 'detail' }), 'memories/working/c.json')

  check('按天查询只返回 gist', () => {
    const rows = db.queryDay(500, 2500)
    assert.deepStrictEqual(rows.map((r) => r.id).sort(), ['a', 'b'])
  })

  check('按天查询 detail', () => {
    const rows = db.queryDay(0, 4000, { fidelity: 'detail' })
    assert.deepStrictEqual(rows.map((r) => r.id), ['c'])
  })

  check('按会话查询只返回 gist', () => {
    const rows = db.querySession('s1')
    assert.deepStrictEqual(rows.map((r) => r.id).sort(), ['a', 'b'])
  })

  check('按会话查询 detail', () => {
    const rows = db.querySession('s1', { fidelity: 'detail' })
    assert.deepStrictEqual(rows.map((r) => r.id), ['c'])
  })

  check('重建索引', () => {
    const n = db.rebuild([rec('x', 5000)], (r) => `memories/episodic/${r.id}.json`)
    assert.strictEqual(n, 1)
    assert.strictEqual(db.stats().count, 1)
  })

  check('删除索引项', () => {
    db.remove('x')
    assert.strictEqual(db.stats().count, 0)
  })

  check('upsert 更新幂等', () => {
    db.upsert(rec('y', 6000, { content: 'v1' }), 'memories/episodic/y.json')
    db.upsert(rec('y', 6000, { content: 'v2' }), 'memories/episodic/y.json')
    assert.strictEqual(db.stats().count, 1)
  })
} finally {
  db.close()
  rmSync(dir, { recursive: true, force: true })
}

console.log(`\n结果：${passed} 通过，${failed} 失败`)
process.exit(failed ? 1 : 0)
