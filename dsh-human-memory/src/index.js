// index.js — DSH 人类记忆插件入口（host 端）
// 通过 ctx.tools.register 注册记忆工具、ctx.commands 注册斜杠命令，
// 并监听 agent/turn-stopping 在会话结束时自动巩固。
// 记忆数据全部落盘到本地 JSON 文件（见 store.js），不联网。

import { defineTool } from '@deepseek-ai/dsh-tools'
import { MemoryEngine } from './memory.js'
import { MemoryStore } from './store.js'
import { loadSettings } from './settings.js'

export const name = 'dsh-human-memory'
export const inject = ['tools']

export function apply(ctx) {
  const settings = loadSettings()
  const engine = new MemoryEngine(settings)
  const store = new MemoryStore(
    settings.storage.dataDir,
    settings.storage.fileName,
    settings.storage.syncWrite,
    settings.storage.flushIntervalMs,
  )

  // 卸载时落盘并清理定时器
  ctx.effect(() => () => store.dispose())

  // ------------------------------------------------------------------
  // 工具：写入记忆
  // ------------------------------------------------------------------
  ctx.tools.register(
    defineTool({
      name: 'memory_write',
      description:
        '把一条值得长期记住的信息写入本地记忆。重要信息（用户偏好、目标、事实、要求）应主动调用。' +
        '同一事件再次被提及时再次调用本工具即可加深记忆（间隔越久加深越多）。',
      parameters: {
        content: { type: 'string', required: true, description: '要记住的内容原文' },
        layer: {
          type: 'string',
          description: '记忆层级：episodic=情节（对话片段）；semantic=语义（提炼的事实/偏好）；core=核心（极重要）。默认 episodic。',
        },
        dwellMs: { type: 'number', description: '在这件事上累计停留的时长（毫秒），越久记忆越深。可选。' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            importance: { type: 'number' },
            layer: { type: 'string' },
          },
        },
        render: (_args, value) => [
          { type: 'text', text: `已记住 ${value.layer} 记忆 #${value.id}（重要性 ${Number(value.importance).toFixed(2)}）` },
        ],
      },
      async execute(args) {
        const content = String(args.content)
        const layer = ['episodic', 'semantic', 'core'].includes(args.layer) ? args.layer : 'episodic'
        const dwellMs = typeof args.dwellMs === 'number' ? args.dwellMs : 0
        // 内容完全一致视为「再次提起」，走间隔效应强化
        const existing = store.all().find((m) => m.content === content)
        const record = engine.write({ content, layer, dwellMs }, existing)
        store.upsert(record)
        return { id: record.id, importance: record.importance, layer: record.layer }
      },
    }),
  )

  // ------------------------------------------------------------------
  // 工具：回忆
  // ------------------------------------------------------------------
  ctx.tools.register(
    defineTool({
      name: 'memory_recall',
      description: '回忆与查询相关的本地记忆，返回按「相关度 + 记忆强度 + 重要性」综合排序的结果。',
      parameters: {
        query: { type: 'string', required: true, description: '要回忆的主题 / 关键词' },
        limit: { type: 'integer', description: '最多返回条数，默认 10' },
      },
      output: {
        schema: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string' },
              content: { type: 'string' },
              layer: { type: 'string' },
              score: { type: 'number' },
            },
          },
        },
        render: (_args, value) => {
          const hits = value
          if (!hits.length) return [{ type: 'text', text: '没有回忆起相关内容。' }]
          const lines = hits.map((h, i) => `${i + 1}. [${Number(h.score).toFixed(2)}] ${h.content}`)
          return [{ type: 'text', text: lines.join('\n') }]
        },
      },
      async execute(args) {
        const limit = typeof args.limit === 'number' ? args.limit : 10
        const hits = engine.recall(store.all(), String(args.query), limit)
        // 检索即复习：被命中的记忆更新访问计数与时间锚点
        const now = Date.now()
        for (const hit of hits) {
          const rec = store.get(hit.id)
          if (rec) store.upsert(engine.recordAccess(rec, now))
        }
        return hits.map((h) => ({ id: h.id, content: h.content, layer: h.layer, score: h.score }))
      },
    }),
  )

  // ------------------------------------------------------------------
  // 工具：遗忘
  // ------------------------------------------------------------------
  ctx.tools.register(
    defineTool({
      name: 'memory_forget',
      description: '删除一条本地记忆（真正遗忘）。',
      parameters: {
        id: { type: 'string', required: true, description: '要删除的记忆 id' },
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { removed: { type: 'boolean' } } },
        render: (_args, value) => [{ type: 'text', text: value.removed ? '已删除。' : '未找到该记忆。' }],
      },
      async execute(args) {
        const removed = store.remove(String(args.id))
        return { removed }
      },
    }),
  )

  // ------------------------------------------------------------------
  // 工具：巩固
  // ------------------------------------------------------------------
  ctx.tools.register(
    defineTool({
      name: 'memory_consolidate',
      description: '把高价值情节记忆合并提炼为语义记忆（模拟睡眠巩固），并归档原始情节记忆。',
      parameters: {},
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { merged: { type: 'number' }, created: { type: 'number' } } },
        render: (_args, value) => [
          { type: 'text', text: `巩固完成：扫描 ${value.merged} 条高价值情节记忆，合并出 ${value.created} 条语义记忆。` },
        ],
      },
      async execute() {
        const res = engine.consolidate(store.all())
        store.replaceAll(res.result)
        return { merged: res.merged, created: res.created }
      },
    }),
  )

  // ------------------------------------------------------------------
  // 工具：复习
  // ------------------------------------------------------------------
  ctx.tools.register(
    defineTool({
      name: 'memory_review',
      description: '列出临近遗忘（记忆强度过低）的记忆，供主动复习。',
      parameters: {},
      output: {
        schema: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string' },
              content: { type: 'string' },
              strength: { type: 'number' },
              layer: { type: 'string' },
            },
          },
        },
        render: (_args, value) => {
          const items = value
          if (!items.length) return [{ type: 'text', text: '当前没有需要复习的记忆。' }]
          const lines = items.map((m, i) => `${i + 1}. [强度 ${Number(m.strength).toFixed(2)}] ${m.content}`)
          return [{ type: 'text', text: '建议复习：\n' + lines.join('\n') }]
        },
      },
      async execute() {
        const due = engine.dueForReview(store.all())
        return due.map((m) => ({ id: m.id, content: m.content, strength: engine.strength(m), layer: m.layer }))
      },
    }),
  )

  // ------------------------------------------------------------------
  // 斜杠命令（用户手动触发，解决「由谁主动复习」的问题）
  // ------------------------------------------------------------------
  const commands = ctx.get('commands')

  if (commands) {
    commands.register({
      name: 'memory-review',
      description: '列出临近遗忘的记忆，主动复习',
      handler() {
        const due = engine.dueForReview(store.all())
        if (!due.length) return { kind: 'success', text: '当前没有需要复习的记忆。' }
        const lines = due.map((m, i) => `${i + 1}. [强度 ${engine.strength(m).toFixed(2)}] ${m.content}`)
        return { kind: 'success', text: '建议复习：\n' + lines.join('\n') }
      },
    })
    commands.register({
      name: 'memory-consolidate',
      description: '手动触发一次巩固（情节记忆 → 语义记忆）',
      handler() {
        const res = engine.consolidate(store.all())
        store.replaceAll(res.result)
        return { kind: 'success', text: `巩固完成：合并出 ${res.created} 条语义记忆。` }
      },
    })
    commands.register({
      name: 'memory-list',
      description: '列出所有本地记忆',
      handler() {
        const all = store.all()
        if (!all.length) return { kind: 'success', text: '暂无记忆。' }
        const lines = all.map((m) => `- [${m.layer}${m.archived ? '/已归档' : ''}] ${m.content}`)
        return { kind: 'success', text: lines.join('\n') }
      },
    })
  }

  // ------------------------------------------------------------------
  // 会话结束自动巩固（睡眠巩固的类比）
  // ------------------------------------------------------------------
  if (settings.consolidation.autoOnTurnEnd) {
    ctx.on('agent/turn-stopping', () => {
      try {
        const res = engine.consolidate(store.all())
        if (res.created > 0) store.replaceAll(res.result)
      } catch (err) {
        console.warn('[dsh-human-memory] 自动巩固失败：', err)
      }
    })
  }

  // ------------------------------------------------------------------
  // 自动复习（可选，默认关闭，由 settings.review.mode 控制）
  // ------------------------------------------------------------------
  if (settings.review.mode === 'auto') {
    let lastReview = 0
    ctx.on('agent/status', (payload) => {
      const now = Date.now()
      if (payload?.status !== 'idle') return
      if (now - lastReview < settings.review.minIntervalMs) return
      const due = engine.dueForReview(store.all(), now)
      if (!due.length) return
      lastReview = now
      const lines = due.map((m) => `- ${m.content}`)
      try {
        payload.agent?.inject?.({
          content: [{ type: 'text', text: '【记忆复习提醒】以下记忆临近遗忘，可择机回顾：\n' + lines.join('\n') }],
          source: { kind: 'dsh-human-memory' },
        })
      } catch {
        /* agent 可能已销毁，忽略 */
      }
    })
  }
}
