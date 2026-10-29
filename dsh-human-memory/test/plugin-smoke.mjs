// test/plugin-smoke.mjs — 用 mock ctx 验证插件入口 apply() 的注册与落盘
// 需要 @deepseek-ai/dsh-tools 存在（真实环境由 DSH 宿主提供；测试可用 mock）。
// 运行：node test/plugin-smoke.mjs
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'dsh-hm-home-'))
process.env.DSH_HOME = home

const mod = await import('../src/index.js')

const tools = []
const commands = []
const listeners = []
const effects = []
const ctx = {
  tools: { register: (t) => { tools.push(t); return () => {} } },
  effect: (fn) => { effects.push(fn); return () => {} },
  on: (ev, fn) => { listeners.push({ ev, fn }); return () => {} },
  get: (n) => (n === 'commands' ? { register: (c) => { commands.push(c); return () => {} } } : undefined),
}

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

check('apply() 注册 5 个工具', tools.length === 5)
check('注册 3 个斜杠命令', commands.length === 3)
check('注册 agent/turn-stopping 监听', listeners.some((l) => l.ev === 'agent/turn-stopping'))

const write = tools.find((t) => t.name === 'memory_write')
const recall = tools.find((t) => t.name === 'memory_recall')
const listCmd = commands.find((c) => c.name === 'memory-list')

const w = await write.execute({ content: '测试：这个项目用 Python 和 Vue 开发', layer: 'episodic', dwellMs: 600000 })
check('memory_write 返回 {id, importance, layer}', !!w.id && typeof w.importance === 'number' && w.layer === 'episodic')

const hits = await recall.execute({ query: '项目 语言', limit: 5 })
check('memory_recall 能召回刚才的内容', hits.some((h) => h.content.includes('Python')))

const r = listCmd.handler({ rawInput: '' })
check('memory-list 命令返回 success', r.kind === 'success' && r.text.includes('Python'))

// 触发 effect 清理 → store.dispose() → 落盘
for (const e of effects) {
  try {
    const d = e()
    if (typeof d === 'function') d()
  } catch {}
}

const file = join(home, 'human-memory', 'memories.json')
check('记忆已落盘到 ' + file, existsSync(file))
if (existsSync(file)) {
  const data = JSON.parse(readFileSync(file, 'utf8'))
  check('落盘文件含至少 1 条记忆', Array.isArray(data.memories) && data.memories.length >= 1)
}

console.log(`\n结果：${ok} 通过，${fail} 失败`)
rmSync(home, { recursive: true, force: true })
process.exit(fail ? 1 : 0)
