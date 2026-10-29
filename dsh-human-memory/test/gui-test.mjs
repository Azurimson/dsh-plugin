// test/gui-test.mjs — 记忆接口路由实测（注册到 DSH webServer 的 /api/dsh-human-memory）
// 用 mock server 捕获 handler，模拟 req/res 验证列表、移入删除缓冲区、恢复、健康检查与 404。运行：node test/gui-test.mjs
import assert from 'node:assert'
import { registerMemoryRoutes, ROUTE_PREFIX } from '../src/gui.js'

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

const now = Date.now()
const current = [
  { id: 'low', content: '低权重记忆', layer: 'episodic', kind: 'fact', importance: 0.2, occurredAt: now },
  { id: 'high', content: '高权重记忆', layer: 'core', kind: 'fact', importance: 0.9, occurredAt: now },
  { id: 'work', content: '写文件：a.txt', layer: 'working', kind: 'tool', importance: 0.05, occurredAt: now },
]
const trash = []

let registered = null
let handler = null
let marked = null
const server = {
  register(opts) {
    registered = opts
    handler = opts.handler
    return () => {}
  },
}

const dispose = registerMemoryRoutes({
  server,
  getMemories: () => current,
  markDeleted: (id) => {
    const idx = current.findIndex((m) => m.id === id)
    if (idx < 0) return false
    trash.push({ ...current[idx], deletedAt: Date.now() })
    current.splice(idx, 1)
    marked = id
    return true
  },
  listTrash: () => trash,
  restoreFromTrash: (id) => {
    const idx = trash.findIndex((m) => m.id === id)
    if (idx < 0) return false
    const rec = trash[idx]
    delete rec.deletedAt
    current.push(rec)
    trash.splice(idx, 1)
    return true
  },
  rootDir: '/tmp/human-memory',
  logger: () => {},
})

function mockRes() {
  const out = { status: 0, headers: null, body: '' }
  return {
    writeHead(code, headers) {
      out.status = code
      out.headers = headers
    },
    end(body) {
      out.body = body
    },
    out,
  }
}

/** 模拟请求；body 为 JSON 字符串时通过 req 的 data/end 事件投递。 */
async function call(method, url, headers = {}, body = null) {
  const handlers = {}
  const req = {
    method,
    url,
    headers,
    on(ev, fn) {
      ;(handlers[ev] = handlers[ev] || []).push(fn)
    },
  }
  const res = mockRes()
  const pending = handler(req, res)
  if (body != null) setTimeout(() => { for (const fn of handlers.data || []) fn(body) }, 0)
  setTimeout(() => { for (const fn of handlers.end || []) fn() }, 0)
  await pending
  return res.out
}

console.log('dsh-human-memory 记忆接口实测\n')

check('注册了 prefix 路由 /api/dsh-human-memory', () => {
  assert(registered)
  assert.strictEqual(registered.kind, 'prefix')
  assert.strictEqual(registered.path, ROUTE_PREFIX)
  assert.strictEqual(typeof dispose, 'function')
})

const r1 = await call('GET', ROUTE_PREFIX + '/memories')
check('GET /memories 返回 200', () => assert.strictEqual(r1.status, 200))
const data = JSON.parse(r1.body)
check('返回全部记忆（含工作记忆）', () => assert.strictEqual(data.memories.length, 3))
check('按权重倒序排列', () => {
  const imp = data.memories.map((m) => m.importance)
  assert.deepStrictEqual(imp, [...imp].sort((a, b) => b - a))
})

// 删除 = 移入删除缓冲区（当前记忆区不再有）
const rDel = await call('POST', ROUTE_PREFIX + '/delete', { 'content-type': 'application/json' }, JSON.stringify({ id: 'low' }))
check('POST /delete 返回 200 且 buffered=true', () => {
  assert.strictEqual(rDel.status, 200)
  assert.strictEqual(JSON.parse(rDel.body).buffered, true)
})
check('删除后已从当前记忆区移除', () => assert(!current.some((m) => m.id === 'low')))
check('删除后已进入删除缓冲区', () => assert(trash.some((m) => m.id === 'low' && m.deletedAt)))
check('软删除后标记了 id', () => assert.strictEqual(marked, 'low'))

const r2 = await call('GET', ROUTE_PREFIX + '/memories')
check('删除后列表隐藏该条', () => {
  const list = JSON.parse(r2.body).memories
  assert.strictEqual(list.length, 2)
  assert(!list.some((m) => m.id === 'low'))
})

const rTrash = await call('GET', ROUTE_PREFIX + '/trash')
check('GET /trash 返回删除缓冲区内容', () => {
  const list = JSON.parse(rTrash.body).memories
  assert.strictEqual(list.length, 1)
  assert.strictEqual(list[0].id, 'low')
})

const rRestore = await call('POST', ROUTE_PREFIX + '/restore', { 'content-type': 'application/json' }, JSON.stringify({ id: 'low' }))
check('POST /restore 恢复成功', () => assert.strictEqual(rRestore.status, 200))
check('恢复后回到当前记忆区', () => assert(current.some((m) => m.id === 'low')))
check('恢复后删除缓冲区为空', () => assert.strictEqual(trash.length, 0))

const r3 = await call('GET', ROUTE_PREFIX + '/health')
check('GET /health 返回 200 与 ok', () => {
  assert.strictEqual(r3.status, 200)
  assert.strictEqual(JSON.parse(r3.body).ok, true)
})

const r4 = await call('GET', ROUTE_PREFIX + '/nope')
check('未知路径返回 404', () => assert.strictEqual(r4.status, 404))

const r5 = await call('POST', ROUTE_PREFIX + '/open-folder')
check('非 JSON 的 POST 被拒绝（415）', () => assert.strictEqual(r5.status, 415))

const r6 = await call('POST', ROUTE_PREFIX + '/delete', { 'content-type': 'application/json' }, JSON.stringify({}))
check('缺少 id 返回 400', () => assert.strictEqual(r6.status, 400))

console.log(`\n结果：${passed} 通过，${failed} 失败`)
process.exit(failed ? 1 : 0)
