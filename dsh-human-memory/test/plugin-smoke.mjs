// test/plugin-smoke.mjs — 用 mock ctx 验证插件入口 apply() 的注册、自动自查、行为/工作记忆与落盘
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
check('apply() 注册 7 个工具', tools.length === 7)
check('注册 4 个斜杠命令', commands.length === 4)
check('注册 agent/turn-stopping 监听', handlers.has('agent/turn-stopping'))
check('注册 session/event 监听（自动自查）', handlers.has('session/event'))

const write = tools.find((t) => t.name === 'memory_write')
const recall = tools.find((t) => t.name === 'memory_recall')
const timeline = tools.find((t) => t.name === 'memory_timeline')
const rescan = tools.find((t) => t.name === 'memory_rescan')
const listCmd = commands.find((c) => c.name === 'memory-list')
check('注册 memory_rescan 工具', !!rescan)

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

// ---------- 每轮自动自查（事实 + 行为 + 工作记忆） ----------
const sid = 'session-test'
const now = Date.now()
emit('session/event', { id: sid }, {
  type: 'user/message',
  time: now,
  data: { content: [{ type: 'text', text: '我的项目使用 Rust 编写后端服务，部署在本地' }], source: { kind: 'user' } },
})
emit('session/event', { id: sid }, {
  type: 'assistant/message',
  time: now + 1,
  data: { message: { content: [{ type: 'text', text: '好的，已记录 Rust 后端与本地部署。' }] } },
})
emit('session/event', { id: sid }, {
  type: 'tool/call',
  time: now + 2,
  data: { turn: 3, step: 1, callId: 'call-1', name: 'write', arguments: JSON.stringify({ path: 'D:/tmp/a.txt' }) },
})
// 同一会话同一操作再次发生 → 应去重（不新增记录）
emit('session/event', { id: sid }, {
  type: 'tool/call',
  time: now + 3,
  data: { turn: 3, step: 1, callId: 'call-2', name: 'write', arguments: JSON.stringify({ path: 'D:/tmp/a.txt' }) },
})
emit('agent/turn-stopping', { agent: { id: sid }, turn: 3, signal: new AbortController().signal })

const autoHits = await recall.execute({ query: 'Rust 后端', limit: 5 })
check('每轮自动自查把用户信息写入事实记忆', autoHits.some((h) => h.content.includes('Rust')))

const tl = await timeline.execute({ sessionId: sid, limit: 10 })
check('行为时间线记录了该轮', tl.some((t) => t.sessionId === sid && t.content.includes('Rust')))
check('行为记忆带轮次与工具', tl.some((t) => t.turn === 3 && t.content.includes('工具：write')))

// 提问不应被自动写入
const sid2 = 'session-test-2'
emit('session/event', { id: sid2 }, {
  type: 'user/message',
  time: now,
  data: { content: [{ type: 'text', text: '这个项目的数据库用的是什么？' }], source: { kind: 'user' } },
})
emit('agent/turn-stopping', { agent: { id: sid2 }, turn: 1, signal: new AbortController().signal })
const qHits = await recall.execute({ query: '数据库 用的是什么', limit: 10 })
check('提问不会被自动写入事实记忆', !qHits.some((h) => h.content.includes('数据库用的是什么')))

// ---------- 重新扫描（memory_rescan） ----------
const rescanned = await rescan.execute({})
check(
  'memory_rescan 返回加载数与索引数',
  typeof rescanned.count === 'number' && rescanned.count >= 1 && typeof rescanned.indexed === 'number',
)

// ---------- 落盘（目录式记忆库） ----------
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
const epFiles = existsSync(ep) ? readdirSync(ep).filter((f) => f.endsWith('.json')) : []
check('每条情景记忆独立成文件', epFiles.length >= 1)

const wd = join(root, 'memories', 'working')
const wdFiles = existsSync(wd) ? readdirSync(wd).filter((f) => f.endsWith('.json')) : []
check('工作记忆（改了什么文件）独立成文件', wdFiles.length >= 1)
check('同一会话同一操作已去重（只保留 1 条）', wdFiles.length === 1)
if (wdFiles.length) {
  const rec = JSON.parse(readFileSync(join(wd, wdFiles[0]), 'utf8'))
  check('工作记忆是低权重（importance ≤ 0.1）', typeof rec.importance === 'number' && rec.importance <= 0.1)
  check('工作记忆内容含文件路径', String(rec.content).includes('D:/tmp/a.txt'))
  check('工作记忆记录了来源会话', rec.sessionId === sid)
}

if (existsSync(join(root, 'index.json'))) {
  const idx = JSON.parse(readFileSync(join(root, 'index.json'), 'utf8'))
  check('索引含发生时间字段', idx.memories.every((m) => typeof m.occurredAt === 'number'))
}

console.log(`\n结果：${ok} 通过，${fail} 失败`)
rmSync(home, { recursive: true, force: true })
process.exit(fail ? 1 : 0)
