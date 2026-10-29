// index.js — DSH 人类记忆插件入口（host 端）
// 通过 ctx.tools.register 注册记忆工具、ctx.commands 注册斜杠命令；
// 监听 session/event 缓冲每轮对话，在 agent/turn-stopping 时自动自查并写入记忆，
// 随后执行巩固。记忆库为目录式（见 store.js），全部本地存储、不联网。

import { defineTool } from '@deepseek-ai/dsh-tools'
import { MemoryEngine, formatDate, parseTime } from './memory.js'
import { MemoryLibrary } from './store.js'
import { loadSettings } from './settings.js'

export const name = 'dsh-human-memory'
export const inject = ['tools']

/** 从 ContentBlock[] / string 中提取纯文本。 */
function textOf(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
}

export function apply(ctx) {
  const settings = loadSettings()
  const engine = new MemoryEngine(settings)
  const store = new MemoryLibrary(
    settings.storage.dataDir,
    settings.storage.fileName,
    settings.storage.syncWrite,
    settings.storage.flushIntervalMs,
  )

  // 卸载时落盘并清理定时器
  ctx.effect(() => () => store.dispose())

  // ------------------------------------------------------------------
  // 自动自查：判断一段文本是否值得记住
  // ------------------------------------------------------------------
  function isWorthRemembering(text) {
    const cfg = settings.autoCapture ?? {}
    const t = String(text ?? '').trim()
    if (!t || t.length < (cfg.minChars ?? 8)) return false
    if (/^[【\[]/.test(t)) return false // 注入的提示 / 文件通知
    if (t.length > 800) return false // 过长的注入文档
    if (/[?？]\s*$/.test(t) || /吗\s*[?？]?\s*$/.test(t)) return false // 提问不是事实
    if (/^(你好|hi|hello|在吗|谢谢|好的|收到|嗯|ok|继续|开始)[!！。.\s]*$/i.test(t)) return false
    const signals =
      /我叫|我是|我的|我们|项目|使用|采用|偏好|喜欢|讨厌|目标|需求|要求|必须|不要|禁止|记住|配置|版本|部署|地址|端口|账号|团队|负责|决定|以后|默认|规则|约定|不能用|要能|改成/
    return signals.test(t)
  }

  function looksInjected(text, source) {
    const t = String(text ?? '')
    // 只过滤明显的注入标记，避免误伤真实用户输入（source.kind 的取值不做硬编码假设）
    if (/^[【\[]/.test(t)) return true
    if (t.length > 800) return true
    const kind = source?.kind
    if (kind === 'system' || kind === 'inject') return true
    return false
  }

  // 每个会话的当轮缓冲：user / assistant 文本 + 本轮事件时间
  const turnBuffers = new Map() // sessionId -> { user: string[], assistant: string[], occurredAt: number }

  function bufferFor(sessionId) {
    let b = turnBuffers.get(sessionId)
    if (!b) {
      b = { user: [], assistant: [], occurredAt: Date.now() }
      turnBuffers.set(sessionId, b)
    }
    return b
  }

  function autoCapture(buf) {
    const cfg = settings.autoCapture ?? {}
    const candidates = []
    for (const text of buf.user) {
      if (isWorthRemembering(text)) candidates.push(text.trim())
    }
    if (cfg.includeAssistant) {
      for (const text of buf.assistant) {
        if (isWorthRemembering(text)) candidates.push(text.trim())
      }
    }
    if (!candidates.length) return 0

    const seen = new Set()
    let added = 0
    for (const content of candidates) {
      if (added >= (cfg.maxPerTurn ?? 3)) break
      if (seen.has(content)) continue
      seen.add(content)
      const existing = store.all().find((m) => m.content === content)
      const rec = engine.write({ content, layer: 'episodic', occurredAt: buf.occurredAt }, existing)
      store.upsert(rec)
      added += 1
    }
    return added
  }

  // ------------------------------------------------------------------
  // 自动自查：监听会话事件，累积每轮文本
  // ------------------------------------------------------------------
  if (settings.autoCapture?.enabled) {
    ctx.on('session/event', (session, event) => {
      try {
        if (!event || !event.type || !session?.id) return
        const time = event.time ?? Date.now()
        if (event.type === 'user/message') {
          const text = textOf(event.data?.content)
          if (!text || looksInjected(text, event.data?.source)) return
          const b = bufferFor(session.id)
          b.user.push(text)
          b.occurredAt = time
          if (b.user.length > 20) b.user.shift()
        } else if (event.type === 'assistant/message' && settings.autoCapture.includeAssistant) {
          const text = textOf(event.data?.message?.content)
          if (!text) return
          const b = bufferFor(session.id)
          b.assistant.push(text)
          if (b.assistant.length > 20) b.assistant.shift()
        }
      } catch (err) {
        /* 观测失败不应影响会话 */
      }
    })

    ctx.on('agent/disposed', (payload) => {
      const sid = payload?.agent?.id
      if (sid) turnBuffers.delete(sid)
    })
  }

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
        occurredAt: {
          type: 'json',
          description: '事件发生时间（可选）：ISO 字符串、YYYY-MM-DD 或 epoch 毫秒。缺省用当前时间。',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            importance: { type: 'number' },
            layer: { type: 'string' },
            occurredAt: { type: 'number' },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: `已记住 ${value.layer} 记忆 #${value.id}（重要性 ${Number(value.importance).toFixed(2)}，发生时间 ${formatDate(value.occurredAt)}）`,
          },
        ],
      },
      async execute(args) {
        const content = String(args.content)
        const layer = ['episodic', 'semantic', 'core'].includes(args.layer) ? args.layer : 'episodic'
        const dwellMs = typeof args.dwellMs === 'number' ? args.dwellMs : 0
        const occurredAt = parseTime(args.occurredAt)
        const existing = store.all().find((m) => m.content === content)
        const record = engine.write({ content, layer, dwellMs, occurredAt }, existing)
        store.upsert(record)
        return {
          id: record.id,
          importance: record.importance,
          layer: record.layer,
          occurredAt: record.occurredAt,
        }
      },
    }),
  )

  // ------------------------------------------------------------------
  // 工具：回忆
  // ------------------------------------------------------------------
  ctx.tools.register(
    defineTool({
      name: 'memory_recall',
      description: '回忆与查询相关的本地记忆，返回按「相关度 + 记忆强度 + 重要性」综合排序的结果，并带事件发生时间。',
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
              occurredAt: { type: 'number' },
            },
          },
        },
        render: (_args, value) => {
          const hits = value
          if (!hits.length) return [{ type: 'text', text: '没有回忆起相关内容。' }]
          const lines = hits.map(
            (h, i) => `${i + 1}. [${Number(h.score).toFixed(2)}] [${formatDate(h.occurredAt)}] ${h.content}`,
          )
          return [{ type: 'text', text: lines.join('\n') }]
        },
      },
      async execute(args) {
        const limit = typeof args.limit === 'number' ? args.limit : 10
        const hits = engine.recall(store.all(), String(args.query), limit)
        const now = Date.now()
        for (const hit of hits) {
          const rec = store.get(hit.id)
          if (rec) store.upsert(engine.recordAccess(rec, now))
        }
        return hits.map((h) => ({
          id: h.id,
          content: h.content,
          layer: h.layer,
          score: h.score,
          occurredAt: h.occurredAt,
        }))
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
              occurredAt: { type: 'number' },
            },
          },
        },
        render: (_args, value) => {
          const items = value
          if (!items.length) return [{ type: 'text', text: '当前没有需要复习的记忆。' }]
          const lines = items.map(
            (m, i) => `${i + 1}. [强度 ${Number(m.strength).toFixed(2)}] [${formatDate(m.occurredAt)}] ${m.content}`,
          )
          return [{ type: 'text', text: '建议复习：\n' + lines.join('\n') }]
        },
      },
      async execute() {
        const due = engine.dueForReview(store.all())
        return due.map((m) => ({
          id: m.id,
          content: m.content,
          strength: engine.strength(m),
          layer: m.layer,
          occurredAt: m.occurredAt ?? m.createdAt,
        }))
      },
    }),
  )

  // ------------------------------------------------------------------
  // 斜杠命令（用户手动触发）
  // ------------------------------------------------------------------
  const commands = ctx.get('commands')

  if (commands) {
    commands.register({
      name: 'memory-review',
      description: '列出临近遗忘的记忆，主动复习',
      handler() {
        const due = engine.dueForReview(store.all())
        if (!due.length) return { kind: 'success', text: '当前没有需要复习的记忆。' }
        const lines = due.map(
          (m, i) => `${i + 1}. [强度 ${engine.strength(m).toFixed(2)}] [${formatDate(m.occurredAt ?? m.createdAt)}] ${m.content}`,
        )
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
      description: '列出所有本地记忆（含发生时间）',
      handler() {
        const all = store.all()
        if (!all.length) return { kind: 'success', text: '暂无记忆。' }
        const lines = all.map(
          (m) => `- [${m.layer}${m.archived ? '/已归档' : ''}] [${formatDate(m.occurredAt ?? m.createdAt)}] ${m.content}`,
        )
        return { kind: 'success', text: lines.join('\n') }
      },
    })
  }

  // ------------------------------------------------------------------
  // 每轮结束：自动自查写入 + 自动巩固
  // ------------------------------------------------------------------
  ctx.on('agent/turn-stopping', (payload) => {
    try {
      const sid = payload?.agent?.id
      // 1) 自动自查写入
      if (settings.autoCapture?.enabled && sid) {
        const buf = turnBuffers.get(sid)
        if (buf) {
          turnBuffers.delete(sid)
          const n = autoCapture(buf)
          if (n > 0) console.log(`[dsh-human-memory] 自动记住 ${n} 条`)
        }
      }
      // 2) 自动巩固
      if (settings.consolidation.autoOnTurnEnd) {
        const res = engine.consolidate(store.all())
        if (res.created > 0) store.replaceAll(res.result)
      }
    } catch (err) {
      console.warn('[dsh-human-memory] 自动处理失败：', err)
    }
  })

  // ------------------------------------------------------------------
  // 自动复习（可选，默认 manual，由 settings.review.mode 控制）
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
      const lines = due.map((m) => `- [${formatDate(m.occurredAt ?? m.createdAt)}] ${m.content}`)
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
