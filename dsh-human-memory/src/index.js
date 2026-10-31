// index.js — DSH 人类记忆插件入口（host 端）
// 注册记忆工具与斜杠命令；监听 session/event 缓冲每轮对话；
// 在 agent/turn-stopping 时自动自查写入「事实记忆」与「行为记忆」并执行巩固；
// 同时启动本地 GUI 服务（设置卡片 / 浏览器访问）。

import { defineTool } from '@deepseek-ai/dsh-tools'
import { join } from 'node:path'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { MemoryEngine, formatDate, parseTime } from './memory.js'
import { MemoryLibrary, resolveDataDir } from './store.js'
import { MemoryIndex } from './index-db.js'
import { loadPersona, setPersonaPath, suggestPersonaDeltas } from './persona.js'
import { loadSettings } from './settings.js'
import { registerMemoryRoutes } from './gui.js'

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

/** 读 JSON 文件；失败返回 null。 */
function readJsonSafe(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

export function apply(ctx) {
  const settings = loadSettings()
  const engine = new MemoryEngine(settings)

  // 记忆库根目录 + SQLite 索引（node:sqlite，零额外构建）
  const memoryRoot = resolveDataDir(settings.storage.dataDir)
  // 人格参数网：默认值 → settings.persona → persona.json
  const personaPath = join(memoryRoot, 'persona.json')
  const persona = loadPersona(settings, readJsonSafe(personaPath))
  let memoryIndex = null
  if (settings.database?.enabled !== false) {
    try {
      const dbDir = settings.database?.dir || '.index'
      const dbFile = settings.database?.fileName || 'memory.sqlite'
      memoryIndex = new MemoryIndex(join(memoryRoot, dbDir, dbFile))
    } catch (err) {
      console.warn('[dsh-human-memory] SQLite 索引初始化失败：', err)
    }
  }

  const store = new MemoryLibrary(
    settings.storage.dataDir,
    settings.storage.fileName,
    settings.storage.syncWrite,
    settings.storage.flushIntervalMs,
    settings.storage.trashDir,
    memoryIndex,
  )

  // ---------- 设置卡片的数据接口（注册到 DSH 内置 Web 服务器） ----------
  if (settings.gui?.enabled !== false) {
    try {
      if (typeof ctx.inject === 'function') {
        ctx.inject(['webServer'], (scoped) => {
          try {
            const reg = () =>
              registerMemoryRoutes({
                server: scoped?.webServer,
                getMemories: () => store.all(),
                markDeleted: (id) => store.moveToTrash(id),
                listTrash: () => store.listTrash(),
                restoreFromTrash: (id) => store.restoreFromTrash(id),
                rootDir: store.rootDir,
                logger: (m) => console.warn('[dsh-human-memory] ' + m),
              })
            if (scoped && typeof scoped.effect === 'function') scoped.effect(reg, 'dsh-human-memory: api')
            else reg()
          } catch (err) {
            console.warn('[dsh-human-memory] 记忆接口注册失败：', err)
          }
        })
      }
    } catch (err) {
      console.warn('[dsh-human-memory] webServer 注入失败：', err)
    }
  }

  // 卸载时落盘并关闭索引
  ctx.effect(() => () => {
    store.dispose()
    try {
      memoryIndex?.close()
    } catch {
      /* ignore */
    }
  })

  // ------------------------------------------------------------------
  // 巩固 + 工作记忆回收：同一个 24 小时节奏
  // ------------------------------------------------------------------
  /**
   * 按固定间隔执行「删除缓冲清理 + 巩固 + 工作记忆回收」，三者同一个 24 小时节点。
   * - 删除缓冲：把上次软删除（deletedAt）的记录真正删掉；
   * - 巩固：合并高价值情节/工作记忆为语义记忆；
   * - 回收：只清理「最后一次访问」超过 workingMemory.minRetentionMs 的工作记忆，
   *   因此不会一次全清，且被召回过的记录会被刷新、延后清理。
   * @param {boolean} force true 时忽略间隔立即执行（手动触发）
   */
  function maybeConsolidate(force = false) {
    const interval = settings.consolidation?.intervalMs ?? 86_400_000
    const st = store.state()
    const now = Date.now()
    if (!force && now - (st.lastConsolidationAt || 0) < interval) return null

    // 1) 删除缓冲区：真正删除
    const purged = store.purgeTrash()

    // 2) 巩固
    const res = engine.consolidate(store.all())
    if (res.created > 0) store.replaceAll(res.result)

    // 3) 工作记忆回收
    let pruned = 0
    if (settings.workingMemory?.enabled) {
      const pr = engine.pruneWorking(store.all(), settings.workingMemory || {}, now)
      for (const id of pr.removed) store.remove(id)
      pruned = pr.removed.length
    }

    store.patchState({ lastConsolidationAt: now })
    return { merged: res.merged, created: res.created, pruned, purged: purged.length }
  }

  // 每小时检查一次；即使没有对话，到点后也会触发
  const consolidateTimer = setInterval(() => {
    try {
      maybeConsolidate()
    } catch (err) {
      console.warn('[dsh-human-memory] 定时巩固失败：', err)
    }
  }, 3_600_000)
  consolidateTimer.unref?.()

  // 启动后稍等片刻检查一次（上次巩固可能已超过 24h）
  const startupTimer = setTimeout(() => {
    try {
      maybeConsolidate()
    } catch {
      /* ignore */
    }
  }, 15_000)
  startupTimer.unref?.()

  ctx.effect(() => () => {
    clearInterval(consolidateTimer)
    clearTimeout(startupTimer)
  })

  // ------------------------------------------------------------------
  // 每轮文本缓冲 + 自动自查
  // ------------------------------------------------------------------
  function isWorthRemembering(text) {
    const cfg = settings.autoCapture ?? {}
    const t = String(text ?? '').trim()
    if (!t || t.length < (cfg.minChars ?? 8)) return false
    if (/^[【\[]/.test(t)) return false
    if (t.length > 800) return false
    if (/[?？]\s*$/.test(t) || /吗\s*[?？]?\s*$/.test(t)) return false
    if (/^(你好|hi|hello|在吗|谢谢|好的|收到|嗯|ok|继续|开始)[!！。.\s]*$/i.test(t)) return false
    const signals =
      /我叫|我是|我的|我们|项目|使用|采用|偏好|喜欢|讨厌|目标|需求|要求|必须|不要|禁止|记住|配置|版本|部署|地址|端口|账号|团队|负责|决定|以后|默认|规则|约定|不能用|要能|改成/
    return signals.test(t)
  }

  function looksInjected(text, source) {
    const t = String(text ?? '')
    if (/^[【\[]/.test(t)) return true
    if (t.length > 800) return true
    const kind = source?.kind
    if (kind === 'system' || kind === 'inject') return true
    return false
  }

  const turnBuffers = new Map() // sessionId -> { user: string[], assistant: string[], tools: string[], occurredAt, turn }

  function bufferFor(sessionId) {
    let b = turnBuffers.get(sessionId)
    if (!b) {
      b = { user: [], assistant: [], tools: [], occurredAt: Date.now(), turn: 0 }
      turnBuffers.set(sessionId, b)
    }
    return b
  }

  const eventIdBySession = new Map()

  /** 同一轮的记录共用一个 eventId（分布式记忆靠它聚合）。 */
  function eventIdFor(sessionId, turn) {
    const id = `evt-${sessionId ?? 'unknown'}-${turn ?? 0}`
    if (sessionId) eventIdBySession.set(sessionId, id)
    return id
  }

  function currentEventId(sessionId) {
    return eventIdBySession.get(sessionId) ?? `evt-${sessionId ?? 'unknown'}-unknown`
  }

  /** 从文本粗提线索（2~6 字中文词 / 3+ 字母词 + 日期）。 */
  function cuesFor(text, occurredAt) {
    const topics = []
    const words = String(text ?? '').match(/[\u4e00-\u9fff]{2,6}|[a-z0-9_]{3,}/gi) ?? []
    for (const w of words) {
      if (!topics.includes(w)) topics.push(w)
    }
    const d = new Date(occurredAt ?? Date.now())
    const time = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    return { topic: topics.slice(0, 5), time }
  }

  function autoCaptureFacts(sessionId, buf) {
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
      const existing = store.all().find((m) => m.content === content && (m.sessionId ?? '') === (sessionId ?? ''))
      const rec = engine.write(
        {
          content,
          layer: 'episodic',
          occurredAt: buf.occurredAt,
          sessionId,
          eventId: currentEventId(sessionId),
          cues: cuesFor(content, buf.occurredAt),
          source: 'user',
          status: 'active',
        },
        existing,
      )
      store.upsert(rec)
      added += 1
    }
    return added
  }

  /** 把一次工具调用写成工作记忆（改了什么文件、跑了什么命令）。 */
  function captureTool(sessionId, name, argsRaw, occurredAt) {
    if (!settings.workingMemory?.enabled) return
    let args = null
    try {
      args = typeof argsRaw === 'string' ? JSON.parse(argsRaw) : argsRaw
    } catch {
      args = null
    }
    const command = args?.command ?? args?.cmd
    const path = args?.path ?? args?.file_path ?? args?.filePath ?? args?.file
    let content
    if (command) {
      content = `运行命令：${String(command).slice(0, 200)}`
    } else if (path) {
      const verb =
        name === 'write' ? '写文件' : name === 'edit' ? '编辑文件' : name === 'read' ? '读取文件' : `${name} 文件`
      content = `${verb}：${String(path).slice(0, 200)}`
    } else {
      content = `调用工具：${name}`
    }

    // 去重：同一会话里的同一操作只保留一条，重复发生时刷新访问时间（顺带延后清理）
    const existing = store
      .all()
      .find((m) => m.layer === 'working' && m.content === content && (m.sessionId ?? '') === (sessionId ?? ''))
    if (existing) {
      store.upsert(engine.recordAccess(existing, Date.now()))
      return
    }

    const now = Date.now()
    const rec = engine.write({
      id: `work-${now}-${Math.random().toString(36).slice(2, 8)}`,
      content,
      layer: 'working',
      kind: 'tool',
      fidelity: 'detail',
      sessionId,
      occurredAt,
      eventId: currentEventId(sessionId),
      cues: cuesFor(content, occurredAt),
      source: 'tool',
      status: 'active',
      importance: settings.workingMemory?.importance ?? 0.05,
    })
    store.upsert(rec)
  }

  /** 把「本轮做了什么」写成行为记忆，供按天/会话时间线检索。 */
  function captureTurn(sessionId, buf) {
    const user = buf.user.join('\n').trim().slice(0, 300)
    const assistant = buf.assistant.join('\n').trim().slice(0, 300)
    if (!user && !assistant) return 0
    const tools = [...new Set(buf.tools)].slice(0, 8)
    const content =
      `会话 ${String(sessionId).slice(0, 8)} · 第 ${buf.turn || 1} 轮` +
      (user ? ` | 用户：${user}` : '') +
      (assistant ? ` | 助手：${assistant}` : '') +
      (tools.length ? ` | 工具：${tools.join(', ')}` : '')
    const existing = store.all().find((m) => m.content === content)
    const eventId = eventIdFor(sessionId, buf.turn)
    const rec = engine.write(
      {
        content,
        layer: 'episodic',
        kind: 'turn',
        sessionId,
        turn: buf.turn,
        occurredAt: buf.occurredAt,
        eventId,
        cues: cuesFor(content, buf.occurredAt),
        source: 'user',
        status: 'active',
      },
      existing,
    )
    store.upsert(rec)
    return 1
  }

  // 监听会话事件，累积本轮文本
  if (settings.autoCapture?.enabled || settings.autoCapture?.turnLog) {
    ctx.on('session/event', (session, event) => {
      try {
        if (!event || !event.type || !session?.id) return
        const time = event.time ?? Date.now()
        const wantAssistant = settings.autoCapture?.includeAssistant || settings.autoCapture?.turnLog
        if (event.type === 'user/message') {
          const text = textOf(event.data?.content)
          if (!text || looksInjected(text, event.data?.source)) return
          const b = bufferFor(session.id)
          b.user.push(text)
          b.occurredAt = time
          if (b.user.length > 20) b.user.shift()
        } else if (event.type === 'assistant/message' && wantAssistant) {
          const text = textOf(event.data?.message?.content)
          if (!text) return
          const b = bufferFor(session.id)
          b.assistant.push(text)
          if (b.assistant.length > 20) b.assistant.shift()
        } else if (event.type === 'tool/call') {
          const name = event.data?.name
          if (!name) return
          const b = bufferFor(session.id)
          b.tools.push(name)
          if (b.tools.length > 50) b.tools.shift()
          captureTool(session.id, name, event.data?.arguments, time)
        }
      } catch {
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
        layer: { type: 'string', description: '记忆层级：episodic=情节；semantic=语义；core=核心。默认 episodic。' },
        dwellMs: { type: 'number', description: '在这件事上累计停留的时长（毫秒）。可选。' },
        occurredAt: { type: 'json', description: '事件发生时间（可选）：ISO 字符串、YYYY-MM-DD 或 epoch 毫秒。' },
        sessionId: { type: 'string', description: '产生该记忆的会话 id（可选，用于区分不同会话，避免混淆）' },
        details: { type: 'array', items: { type: 'string' }, description: '细节列表（可选）：文件、命令、周边信息等；默认不返回，需要 detail 才带出' },
        eventId: { type: 'string', description: '同一事件的 id（可选）：把一个事件的分布式记忆串起来' },
        cues: { type: 'json', description: '线索（可选）：{ person, place, topic, time, emotion }' },
        source: { type: 'string', description: '来源：user / assistant / tool / inference / self' },
        confidence: { type: 'number', description: '置信度 0~1（推断建议 < 1）' },
        status: { type: 'string', description: '状态：active / candidate / superseded' },
        validFrom: { type: 'json', description: '有效开始时间（可选）' },
        validTo: { type: 'json', description: '有效结束时间（可选）' },
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
        const layer = ['episodic', 'semantic', 'core', 'working', 'procedural', 'autobiographical'].includes(args.layer)
          ? args.layer
          : 'episodic'
        const dwellMs = typeof args.dwellMs === 'number' ? args.dwellMs : 0
        const occurredAt = parseTime(args.occurredAt)
        const sessionId = typeof args.sessionId === 'string' && args.sessionId ? args.sessionId : undefined
        const details = Array.isArray(args.details) ? args.details.filter((d) => typeof d === 'string') : []
        const eventId = typeof args.eventId === 'string' && args.eventId ? args.eventId : undefined
        const cues = args.cues && typeof args.cues === 'object' ? args.cues : undefined
        const source = typeof args.source === 'string' ? args.source : 'user'
        const confidence = typeof args.confidence === 'number' ? args.confidence : 1
        const status = ['active', 'candidate', 'superseded'].includes(args.status) ? args.status : 'active'
        const validFrom = parseTime(args.validFrom)
        const validTo = parseTime(args.validTo)
        const existing = store.all().find((m) => m.content === content)
        const record = engine.write(
          { content, layer, dwellMs, occurredAt, sessionId, details, eventId, cues, source, confidence, status, validFrom, validTo },
          existing,
        )
        store.upsert(record)
        return { id: record.id, importance: record.importance, layer: record.layer, occurredAt: record.occurredAt }
      },
    }),
  )

  // ------------------------------------------------------------------
  // 工具：回忆（事实记忆）
  // ------------------------------------------------------------------
  ctx.tools.register(
    defineTool({
      name: 'memory_recall',
      description:
        '回忆与查询相关的记忆，返回按「相关度 + 记忆强度 + 重要性」排序的结果，并带事件发生时间与情绪标记。' +
        '默认只返回梗概；需要细节时传 detail=true。',
      parameters: {
        query: { type: 'string', required: true, description: '要回忆的主题 / 关键词' },
        limit: { type: 'integer', description: '最多返回条数，默认 10' },
        detail: { type: 'boolean', description: '是否返回细节记录（默认 false，只返回梗概）' },
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
              fidelity: { type: 'string' },
              details: { type: 'array', items: { type: 'string' } },
              emotionKind: { type: 'string' },
              emotionIntensity: { type: 'number' },
              emotionCore: { type: 'string' },
              score: { type: 'number' },
              occurredAt: { type: 'number' },
              sessionId: { type: 'string' },
            },
          },
        },
        render: (_args, value) => {
          const hits = value
          if (!hits.length) return [{ type: 'text', text: '没有回忆起相关内容。' }]
          const lines = hits.map((h, i) => {
            const sid = h.sessionId ? `（会话 ${String(h.sessionId).slice(0, 8)}）` : ''
            const emo =
              h.emotionIntensity >= 0.2
                ? ` [情绪:${h.emotionKind} ${Number(h.emotionIntensity).toFixed(2)}]`
                : ''
            const head = `${i + 1}. [${Number(h.score).toFixed(2)}] [${formatDate(h.occurredAt)}] ${h.content}${emo}${sid}`
            const detailLines = Array.isArray(h.details) && h.details.length ? h.details.map((d) => `   · ${d}`) : []
            return [head, ...detailLines].join('\n')
          })
          return [{ type: 'text', text: lines.join('\n') }]
        },
      },
      async execute(args) {
        const limit = Math.min(Math.max(1, Number(args.limit) || 10), 50)
        const detail = args.detail === true
        const hits = engine.recall(store.all(), String(args.query), limit, Date.now(), detail)
        const now = Date.now()
        for (const hit of hits) {
          const rec = store.get(hit.id)
          if (rec) store.upsert(engine.recordAccess(rec, now))
        }
        return hits.map((h) => ({
          id: h.id,
          content: h.content,
          layer: h.layer,
          fidelity: h.fidelity,
          details: h.details ?? [],
          emotionKind: h.emotionKind ?? 'neutral',
          emotionIntensity: h.emotionIntensity ?? 0,
          emotionCore: h.emotionCore ?? '',
          score: h.score,
          occurredAt: h.occurredAt,
          sessionId: h.sessionId ?? '',
        }))
      },
    }),
  )

  // ------------------------------------------------------------------
  // 工具：行为时间线
  // ------------------------------------------------------------------
  ctx.tools.register(
    defineTool({
      name: 'memory_timeline',
      description: '按天或按会话检索「每一轮做了什么」，按时间正序返回，可用于回答「那天那个会话做了什么」。传 detail=true 可附带细节。',
      parameters: {
        date: { type: 'string', description: '日期 YYYY-MM-DD（可选，不填则不限日期）' },
        sessionId: { type: 'string', description: '会话 id（可选）' },
        detail: { type: 'boolean', description: '是否附带细节（默认 false）' },
        limit: { type: 'integer', description: '最多返回条数，默认 50' },
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
              details: { type: 'array', items: { type: 'string' } },
              fidelity: { type: 'string' },
              emotionKind: { type: 'string' },
              emotionIntensity: { type: 'number' },
              occurredAt: { type: 'number' },
              sessionId: { type: 'string' },
              turn: { type: 'number' },
            },
          },
        },
        render: (_args, value) => {
          const rows = value
          if (!rows.length) return [{ type: 'text', text: '该时间范围内没有行为记录。' }]
          const lines = rows.map((r) => {
            const emo = r.emotionIntensity >= 0.2 ? ` [情绪:${r.emotionKind} ${Number(r.emotionIntensity).toFixed(2)}]` : ''
            const head = `- [${formatDate(r.occurredAt)}] ${r.content}${emo}`
            const detailLines = Array.isArray(r.details) && r.details.length ? r.details.map((d) => `   · ${d}`) : []
            return [head, ...detailLines].join('\n')
          })
          return [{ type: 'text', text: '行为时间线：\n' + lines.join('\n') }]
        },
      },
      async execute(args) {
        const limit = Math.min(Math.max(1, Number(args.limit) || 50), 500)
        const detail = args.detail === true
        const rows = engine.timeline(
          store.all(),
          { date: args.date, sessionId: args.sessionId, detail },
          limit,
        )
        return rows.map((r) => ({
          id: r.id,
          content: r.content,
          details: r.details ?? [],
          fidelity: r.fidelity ?? 'gist',
          emotionKind: r.emotionKind ?? 'neutral',
          emotionIntensity: r.emotionIntensity ?? 0,
          occurredAt: r.occurredAt ?? r.createdAt,
          sessionId: r.sessionId ?? '',
          turn: r.turn ?? 0,
        }))
      },
    }),
  )

  // ------------------------------------------------------------------
  // 工具：重构 / 续接 / 预测（0.1.4）
  // ------------------------------------------------------------------
  ctx.tools.register(
    defineTool({
      name: 'memory_reconstruct',
      description:
        '按当前线索把分布式记忆重新组合成一个版本（情景/语义/情绪/程序/自传体），返回组合文本、缺口与来源。' +
        '这是「回忆」而不是「检索」：不落盘，每次按线索重新生成；被引用的记录会记一次再巩固。',
      parameters: {
        cue: { type: 'string', required: true, description: '当前线索 / 问题' },
        detail: { type: 'boolean', description: '是否带出细节' },
        asOf: { type: 'json', description: '查某个时间点（ISO / YYYY-MM-DD / epoch）' },
        limit: { type: 'integer', description: '最多取材条数，默认 8' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            composed: { type: 'string' },
            eventId: { type: 'string' },
            gaps: { type: 'array', items: { type: 'string' } },
            confidence: { type: 'number' },
            sources: { type: 'array', items: { type: 'string' } },
            regions: { type: 'object', additionalProperties: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: value.composed }],
      },
      async execute(args) {
        const asOf = parseTime(args.asOf)
        const result = engine.reconstruct(store.all(), String(args.cue), {
          persona,
          detail: args.detail === true,
          asOf: asOf ?? null,
          limit: Math.min(Math.max(1, Number(args.limit) || 8), 20),
        })
        // 再巩固：被重构过的记录留下痕迹，但不改原文
        const now = Date.now()
        for (const id of result.sources) {
          const rec = store.get(id)
          if (!rec) continue
          store.upsert({
            ...rec,
            reconsolidationCount: (rec.reconsolidationCount ?? 0) + 1,
            lastReconstructedAt: now,
            lastAccessedAt: now,
          })
        }
        return {
          composed: result.composed,
          eventId: result.eventId ?? '',
          gaps: result.gaps,
          confidence: result.confidence,
          sources: result.sources,
          regions: result.regions,
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'memory_resume',
      description:
        '阶段性续接：把某个会话的顺序记录重新拼成「目标 / 做到哪 / 最后一步 / 下一步」。不落盘，纯读时重构。',
      parameters: { sessionId: { type: 'string', required: true, description: '会话 id' } },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            sessionId: { type: 'string' },
            goal: { type: 'string' },
            done: { type: 'array', items: { type: 'string' } },
            last: { type: 'string' },
            next: { type: 'string' },
            confidence: { type: 'number' },
            related: { type: 'object', additionalProperties: true },
          },
        },
        render: (_args, value) => {
          const lines = [
            `目标：${value.goal || '（未记录）'}`,
            `做到：${value.done.length ? value.done.join('；') : '（无）'}`,
            `最后一步：${value.last || '（无）'}`,
            `下一步：${value.next || '（由当前上下文推断）'}`,
          ]
          return [{ type: 'text', text: lines.join('\n') }]
        },
      },
      async execute(args) {
        return engine.resume(store.all(), String(args.sessionId), { persona })
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'memory_predict',
      description: '用已有经验预测当前情境：语义给概念、情景给类似案例、程序给后果、情绪给风险。',
      parameters: { situation: { type: 'string', required: true, description: '当前情境' } },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            situation: { type: 'string' },
            prediction: { type: 'string' },
            gaps: { type: 'array', items: { type: 'string' } },
            sources: { type: 'array', items: { type: 'string' } },
            what: { type: 'array', items: { type: 'object', additionalProperties: true } },
            before: { type: 'array', items: { type: 'object', additionalProperties: true } },
            how: { type: 'array', items: { type: 'object', additionalProperties: true } },
            risk: { type: 'array', items: { type: 'object', additionalProperties: true } },
          },
        },
        render: (_args, value) => [{ type: 'text', text: value.prediction }],
      },
      async execute(args) {
        return engine.predict(store.all(), String(args.situation), { persona })
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'memory_feedback',
      description: '记录一条人格反馈（如「说话要更有逻辑」），作为普通记忆存储，供人格参数调整参考。',
      parameters: {
        trait: {
          type: 'string',
          required: true,
          description: '参数名：logic / warmth / caution / directness / verbosity / attention_* / retrieval_*',
        },
        direction: { type: 'string', description: 'increase 或 decrease' },
        note: { type: 'string', description: '反馈原文' },
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' } } },
        render: (_args, value) => [{ type: 'text', text: `已记下反馈：${value.id}` }],
      },
      async execute(args) {
        const trait = String(args.trait)
        const direction = String(args.direction ?? 'increase').toLowerCase() === 'decrease' ? 'decrease' : 'increase'
        const note = String(args.note ?? `${trait} 应${direction === 'decrease' ? '减弱' : '加强'}`)
        const rec = engine.write({
          content: `人格反馈：${note}`,
          layer: 'autobiographical',
          kind: 'feedback',
          source: 'user',
          status: 'active',
          cues: { topic: [trait] },
          details: [trait, direction],
          importance: 0.8,
        })
        rec.trait = trait
        rec.direction = direction
        store.upsert(rec)
        return { id: rec.id }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'memory_persona',
      description: '查看当前人格参数、最近的反馈记忆，以及由反馈推导出的参数增量建议（不自动修改）。',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            persona: { type: 'object', additionalProperties: true },
            suggestions: { type: 'object', additionalProperties: true },
            feedback: { type: 'array', items: { type: 'object', additionalProperties: true } },
          },
        },
        render: (_args, value) => {
          const lines = Object.entries(value.persona || {}).map(([g, o]) => `${g}: ${JSON.stringify(o)}`)
          const sug = Object.entries(value.suggestions || {}).map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`)
          return [{ type: 'text', text: lines.join('\n') + (sug.length ? `\n建议：${sug.join('；')}` : '') }]
        },
      },
      async execute() {
        const feedback = store.all().filter((m) => m.kind === 'feedback').slice(-10)
        return { persona, suggestions: suggestPersonaDeltas(feedback), feedback }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'memory_persona_update',
      description: '修改一个人格参数并持久化到 persona.json（例如 path=interpretation.logic, value=0.7）。',
      parameters: {
        path: { type: 'string', required: true, description: '参数路径，如 interpretation.logic / retrieval.episodic' },
        value: { type: 'number', required: true, description: '新值（0~2）' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { ok: { type: 'boolean' }, persona: { type: 'object', additionalProperties: true } },
        },
        render: (_args, value) => [{ type: 'text', text: value.ok ? '人格参数已更新。' : '参数路径无效。' }],
      },
      async execute(args) {
        const ok = setPersonaPath(persona, String(args.path), Number(args.value))
        if (ok) store.writeAtomic(personaPath, JSON.stringify(persona, null, 2))
        return { ok, persona }
      },
    }),
  )

  // ------------------------------------------------------------------
  // 工具：遗忘 / 巩固 / 复习 / GUI
  // ------------------------------------------------------------------
  ctx.tools.register(
    defineTool({
      name: 'memory_forget',
      description: '删除一条本地记忆（真正遗忘）。',
      parameters: { id: { type: 'string', required: true, description: '要删除的记忆 id' } },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { removed: { type: 'boolean' } } },
        render: (_args, value) => [{ type: 'text', text: value.removed ? '已删除。' : '未找到该记忆。' }],
      },
      async execute(args) {
        return { removed: store.remove(String(args.id)) }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'memory_rescan',
      description:
        '重新扫描记忆库并从文件重建索引。当用户要求「重新扫描记忆」「刷新记忆库」，或外部改动过记忆文件后，应调用本工具。',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { count: { type: 'number' }, indexed: { type: 'number' } },
        },
        render: (_args, value) => [
          { type: 'text', text: `已重新扫描：加载 ${value.count} 条记忆，索引 ${value.indexed} 条。` },
        ],
      },
      async execute() {
        const count = store.reload()
        const stats = memoryIndex?.stats() || { count: 0 }
        return { count, indexed: stats.count }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'memory_doctor',
      description: '检查记忆库健康：记录数、各层数量、索引状态、回收站、损坏文件、候选记忆与反馈记忆数量。',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            records: { type: 'number' },
            layers: { type: 'object', additionalProperties: true },
            index: { type: 'object', additionalProperties: true },
            trash: { type: 'number' },
            corrupt: { type: 'number' },
            candidates: { type: 'number' },
            feedback: { type: 'number' },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text:
              `记录 ${value.records} 条；索引 ${value.index.count} 条（${value.index.available ? '可用' : '不可用'}）；` +
              `回收站 ${value.trash} 条；损坏文件 ${value.corrupt} 个；候选 ${value.candidates} 条；反馈 ${value.feedback} 条。`,
          },
        ],
      },
      async execute() {
        const all = store.all()
        const layers = {}
        for (const r of all) layers[r.layer ?? 'unknown'] = (layers[r.layer ?? 'unknown'] ?? 0) + 1

        let corrupt = 0
        try {
          const layersOnDisk = ['working', 'episodic', 'semantic', 'core', 'procedural', 'autobiographical']
          for (const layer of layersOnDisk) {
            const dir = join(memoryRoot, 'memories', layer)
            if (!existsSync(dir)) continue
            for (const f of readdirSync(dir)) {
              if (!f.endsWith('.json')) continue
              try {
                JSON.parse(readFileSync(join(dir, f), 'utf8'))
              } catch {
                corrupt += 1
              }
            }
          }
        } catch {
          /* 诊断本身不抛错 */
        }

        return {
          records: all.length,
          layers,
          index: memoryIndex?.stats() ?? { available: false, count: 0 },
          trash: store.listTrash().length,
          corrupt,
          candidates: all.filter((m) => m.status === 'candidate').length,
          feedback: all.filter((m) => m.kind === 'feedback').length,
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'memory_consolidate',
      description: '手动执行一次「巩固 + 工作记忆回收」（平时每 24 小时自动执行一次）。',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            merged: { type: 'number' },
            created: { type: 'number' },
            pruned: { type: 'number' },
            purged: { type: 'number' },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: `巩固完成：扫描 ${value.merged} 条高价值记忆，合并出 ${value.created} 条语义记忆，回收 ${value.pruned} 条过期工作记忆，清理 ${value.purged} 条删除缓冲区记录。`,
          },
        ],
      },
      async execute() {
        const res = maybeConsolidate(true) || { merged: 0, created: 0, pruned: 0, purged: 0 }
        return { merged: res.merged, created: res.created, pruned: res.pruned, purged: res.purged }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'memory_review',
      description: '列出临近遗忘（记忆强度过低）的事实记忆，供主动复习。',
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
  // 斜杠命令
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
      description: '手动触发一次「巩固 + 工作记忆回收」',
      handler() {
        const res = maybeConsolidate(true) || { created: 0, pruned: 0, purged: 0 }
        return {
          kind: 'success',
          text: `巩固完成：合并出 ${res.created} 条语义记忆，回收 ${res.pruned} 条过期工作记忆，清理 ${res.purged} 条删除缓冲区记录。`,
        }
      },
    })
    commands.register({
      name: 'memory-list',
      description: '列出所有本地记忆（含发生时间）',
      handler() {
        const all = store.all().filter((m) => !m.deletedAt)
        if (!all.length) return { kind: 'success', text: '暂无记忆。' }
        const sorted = all.slice().sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0))
        const shown = sorted.slice(0, 200)
        const lines = shown.map(
          (m) => `- [${m.layer}${m.kind === 'turn' ? '/行为' : ''}${m.archived ? '/已归档' : ''}] [${formatDate(m.occurredAt ?? m.createdAt)}] ${m.content}`,
        )
        const suffix = all.length > shown.length ? `\n…（共 ${all.length} 条，仅显示权重最高的 ${shown.length} 条）` : ''
        return { kind: 'success', text: lines.join('\n') + suffix }
      },
    })
    commands.register({
      name: 'memory-rescan',
      description: '重新扫描记忆库并重建索引',
      handler() {
        const count = store.reload()
        const stats = memoryIndex?.stats() || { count: 0 }
        return { kind: 'success', text: `已重新扫描：加载 ${count} 条记忆，索引 ${stats.count} 条。` }
      },
    })
  }

  // ------------------------------------------------------------------
  // 每轮结束：自动自查（事实 + 行为）+ 自动巩固
  // ------------------------------------------------------------------
  ctx.on('agent/turn-stopping', (payload) => {
    try {
      const sid = payload?.agent?.id
      if (sid) {
        const buf = turnBuffers.get(sid)
        if (buf) {
          turnBuffers.delete(sid)
          buf.turn = payload?.turn ?? buf.turn
          if (settings.autoCapture?.enabled) autoCaptureFacts(sid, buf)
          if (settings.autoCapture?.turnLog) captureTurn(sid, buf)
        }
      }
      // 巩固与工作记忆回收都按 24 小时间隔触发（不是每轮）
      if (settings.consolidation?.autoOnTurnEnd) maybeConsolidate()
    } catch (err) {
      console.warn('[dsh-human-memory] 自动处理失败：', err)
    }
  })

  // ------------------------------------------------------------------
  // 自动复习（可选，默认 manual）
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
