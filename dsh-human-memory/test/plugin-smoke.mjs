// test/plugin-smoke.mjs — 用 mock ctx 验证插件入口 apply() 的注册、自动自查与落盘
// 需要 @deepseek-ai/dsh-tools 存在（真实环境由 DSH 宿主提供；测试可用 mock）。
// 运行：node test/plugin-smoke.mjs
import { mkdtempSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'dsh-hm-home-'))
process.env.DSH_HOME = home

const mod = await import('../src/index.js')

const tools = []
const commands = []
const listeners = []
const handlers = new Map() // event name -> [fn]
const effects = []
const ctx = {
  tools: { register: (t) => { tools.push(t); return () => {} } },
  effect: (fn) => { effects.push(fn); return () => {} },
  on: (ev, fn) => {
    listeners.push({ ev, fn })
    if (!handlers.has(ev)) handlers.set(ev, [])
    handlers.get(ev).push(fn)
    return () => {}
  },
  get: (n) => (n === 'commands' ? { register: (c) => { commands.push(c); return () => {} } } : undefined),
}
const emit = (ev, ...args) => { for (const fn of handlers.get(ev) ?? []) fn(...args) }

let ok = 0
let fail = 0
const check = (name, cond) => {
  if (cond) {
    ok++
    console.log('  ✓ ' + name)
  } else {
    fail++
    console.log('  ✗ ' + name)
  }
}

mod.apply(ctx)

// ---------- 注册 ----------
check('apply() 注册 5 个工具', tools.length === 5)
check('注册 3 个斜杠命令', commands.length === 3)
check('注册 agent/turn-stopping 监听', handlers.has('agent/turn-stopping'))
check('注册 session/event 监听（自动自查）', handlers.has('session/event'))

const write = tools.find((t) => t.name === 'memory_write')
const recall = tools.find((t) => t.name === 'memory_recall')
const listCmd = commands.find((c) => c.name === 'memory-list')

// ---------- 显式写入 / 召回 ----------
const w = await write.execute({ content: '测试：这个项目用 Python 和 Vue 开发', layer: 'episodic', dwellMs: 600000 })
check(
  'memory_write 返回 id/importance/layer/occurredAt',
  !!w.id && typeof w.importance === 'number' && typeof w.occurredAt === 'number',
)

const hits = await recall.execute({ query: '项目 语言', limit: 5 })
check(
  'memory_recall 召回并带发生时间',
  hits.some((h) => h.content.includes('Python') && typeof h.occurredAt === 'number'),
)

const r = listCmd.handler({ rawInput: '' })
check('memory-list 命令含日期', r.kind === 'success' && r.text.includes('Python') && /\d{4}-\d{2}-\d{2}/.test(r.text))

// ---------- 每轮自动自查 ----------
const sid = 'session-test'
emit('session/event', { id: sid }, {
  type: 'user/message',
  time: Date.now(),
  data: { content: [{ type: 'text', text: '我的项目使用 Rust 编写后端服务，部署在本地' }], source: { kind: 'user' } },
})
emit('agent/turn-stopping', { agent: { id: sid }, turn: 1, signal: new AbortController().signal })
const autoHits = await recall.execute({ query: 'Rust 后端', limit: 5 })
check('每轮自动自查把用户信息写入记忆', autoHits.some((h) => h.content.includes('Rust')))

// 提问不应被自动写入
const sid2 = 'session-test-2'
emit('session/event', { id: sid2 }, {
  type: 'user/message',
  time: Date.now(),
  data: { content: [{ type: 'text', text: '这个项目的数据库用的是什么？' }], source: { kind: 'user' } },
})
emit('agent/turn-stopping', { agent: { id: sid2 }, turn: 1, signal: new AbortController().signal })
const qHits = await recall.execute({ query: '数据库 用的是什么', limit: 10 })
check('提问不会被自动写入', !qHits.some((h) => h.content.includes('数据库用的是什么')))

// ---------- 目录式记忆库 ----------
for (const e of effects) {
  try {
    const d = e()
    if (typeof d === 'function') d()
  } catch {}
}
const root = join(home, 'human-memory')
check('生成 index.json 索引', existsSync(join(root, 'index.json')))
check('生成 memories/episodic 目录', existsSync(join(root, 'memories', 'episodic')))
const ep = join(root, 'memories', 'episodic')
const files = existsSync(ep) ? readdirSync(ep).filter((f) => f.endsWith('.json')) : []
check('每条记忆独立成文件', files.length >= 1)
if (existsSync(join(root, 'index.json'))) {
  const idx = JSON.parse(readFileSync(join(root, 'index.json'), 'utf8'))
  check('索引含发生时间字段', idx.memories.every((m) => typeof m.occurredAt === 'number'))
}

console.log(`\n结果：${ok} 通过，${fail} 失败`)
rmSync(home, { recursive: true, force: true })
process.exit(fail ? 1 : 0)
