// memory.js — 记忆引擎核心
// 实现「人类式记忆」的四个机制：
//   1. 时间衰减（遗忘曲线）——惰性计算，不主动更新
//   2. 内容重要性评分（六维，含「记忆时长」）
//   3. 间隔重复 + 间隔效应（间隔越长，再次提起加权越高）
//   4. 巩固（只扫高价值情节记忆，合并成语义记忆）
// 本文件不依赖任何 DSH 运行时，可独立运行/测试。

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** 简单哈希，用于生成稳定 id。 */
function hashCode(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/** 中文按单字 + 双字组切分，英文按单词切分，做相关性匹配用。 */
function tokenize(text) {
  const tokens = new Set()
  const words = text.toLowerCase().match(/[a-z0-9_]+/g) ?? []
  for (const w of words) tokens.add(w)
  const cjk = text.match(/[\u4e00-\u9fff]+/g) ?? []
  for (const run of cjk) {
    for (const ch of run) tokens.add(ch)
    for (let i = 0; i + 1 < run.length; i++) tokens.add(run.slice(i, i + 2))
  }
  return tokens
}

/** 词元重合相似度（Ochiai 系数，介于 0 与 1 之间）。 */
function similarity(a, b) {
  const ta = tokenize(a)
  const tb = tokenize(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter += 1
  return inter / Math.sqrt(ta.size * tb.size)
}

/** 把 epoch 毫秒格式化为本地「YYYY-MM-DD HH:mm」，用于回答「这件事是什么时候发生的」。 */
export function formatDate(ts) {
  if (!Number.isFinite(ts)) return '未知时间'
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 解析时间：接受 epoch 毫秒、纯日期（YYYY-MM-DD）、或 ISO 字符串；失败返回 null。 */
export function parseTime(value) {
  if (value == null || value === '') return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const s = String(value).trim()
  if (/^\d+$/.test(s)) return Number(s)
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
  const t = Date.parse(s)
  return Number.isFinite(t) ? t : null
}

export class MemoryEngine {
  constructor(settings) {
    this.settings = settings
    this.impWeights = this.normalize(settings.importance, ['dwellRefMs'])
    this.retWeights = this.normalize(settings.retrieval)
  }

  /** 把配置对象里除「排除键」外的数值权重归一化到和为 1。 */
  normalize(obj, exclude = []) {
    const out = { ...obj }
    let sum = 0
    for (const [k, v] of Object.entries(out)) {
      if (exclude.includes(k)) continue
      sum += Math.abs(v)
    }
    if (sum === 0) return out
    for (const [k] of Object.entries(out)) {
      if (exclude.includes(k)) continue
      out[k] = out[k] / sum
    }
    return out
  }

  // ------------------------------------------------------------------
  // 1. 内容重要性评分（六维，含「记忆长度」）
  // ------------------------------------------------------------------

  /** 记忆时长因子：停留越久越接近 1（饱和曲线）。 */
  dwellFactor(dwellMs) {
    const ref = this.settings.importance.dwellRefMs || 60_000
    return 1 - Math.exp(-dwellMs / ref)
  }

  /** 计算内容重要性（0..1）。六维权重已归一化到 1。 */
  computeImportance(factors) {
    const w = this.impWeights
    return clamp01(
      w.selfRelevance * factors.selfRelevance +
        w.causality * factors.causality +
        w.concreteness * factors.concreteness +
        w.uniqueness * factors.uniqueness +
        w.emotion * factors.emotion +
        w.dwell * factors.dwell,
    )
  }

  /** 由文本启发式估算六维内容分（无 LLM 时的降级方案）。 */
  estimateFactors(content) {
    const hasCause = /因为|所以|由于|导致|先|然后|再|最后|因此|如果|就/.test(content)
    const hasNamed = /[A-Z][a-zA-Z]+|[\u4e00-\u9fff]{2,}项目|先生|女士|系统|数据库|函数|文件/.test(content)
    const hasNumber = /\d{2,}/.test(content)
    const hasEmotion = /喜欢|讨厌|重要|必须|害怕|高兴|生气|担心|满意|希望|不想|绝对不能/.test(content)
    const uniqueLen = Math.min(content.length / 200, 1)
    return {
      selfRelevance: /我|我们|你|目标|需求|偏好|身份|项目/.test(content) ? 0.7 : 0.3,
      causality: hasCause ? 0.8 : 0.3,
      concreteness: (hasNamed ? 0.5 : 0) + (hasNumber ? 0.4 : 0),
      uniqueness: 0.3 + 0.5 * uniqueLen,
      emotion: hasEmotion ? 0.8 : 0.2,
      dwell: 0.5,
    }
  }

  // ------------------------------------------------------------------
  // 2. 时间衰减（遗忘曲线）——惰性计算
  // ------------------------------------------------------------------

  /**
   * 当前记忆强度（0..1）。
   * 从不「每天更新」，只在读取时用 (now - lastAccessedAt) 现算，无需后台任务。
   */
  strength(record, now = Date.now()) {
    const f = this.settings.forgetting
    const ageMs = Math.max(0, now - record.lastAccessedAt)
    let retention
    if (f.usePowerLaw) {
      retention = Math.pow(1 + ageMs / f.tauMs, -f.powerBeta)
    } else {
      retention = Math.exp(-Math.pow(ageMs / f.tauMs, f.c))
    }
    return clamp01(record.importance * retention)
  }

  // ------------------------------------------------------------------
  // 3. 间隔重复 + 间隔效应
  // ------------------------------------------------------------------

  /** 「再次提起」一条记忆：间隔越长，加权提升越高（间隔效应）。 */
  reinforce(record, now = Date.now()) {
    const sp = this.settings.spacing
    const gapMs = Math.max(0, now - record.lastAccessedAt)
    const spacingWeight = 1 + sp.kappa * Math.log2(1 + gapMs / (sp.spacingTauMs || 86_400_000))
    const boosted = clamp01(record.importance + sp.reinforce * spacingWeight)
    return {
      ...record,
      importance: Math.min(boosted, sp.maxImportance),
      mentionCount: record.mentionCount + 1,
      lastAccessedAt: now,
      reviewHistory: [...record.reviewHistory, now],
      archived: false,
    }
  }

  /** 记录一次成功检索（检索即复习）：轻微强化 + 更新访问计数。 */
  recordAccess(record, now = Date.now()) {
    return { ...record, accessCount: record.accessCount + 1, lastAccessedAt: now }
  }

  /**
   * 软删除：标记 `deletedAt`。记录会立即从界面与召回中消失，
   * 但数据保留到下一次巩固时才真正删除（删除缓冲区）。
   */
  markDeleted(record, now = Date.now()) {
    return { ...record, deletedAt: now }
  }

  // ------------------------------------------------------------------
  // 4. 检索（综合相关度 + 强度 + 重要性排序）
  // ------------------------------------------------------------------

  recall(records, query, limit = 10, now = Date.now()) {
    const w = this.retWeights
    return records
      .filter((r) => !r.archived && !r.deletedAt && r.kind !== 'turn')
      .map((r) => {
        const relevance = similarity(query, r.content)
        const s = this.strength(r, now)
        const score = w.relevance * relevance + w.strength * s + w.importance * r.importance
        return {
          id: r.id,
          content: r.content,
          layer: r.layer,
          score,
          strength: s,
          relevance,
          importance: r.importance,
          occurredAt: r.occurredAt ?? r.createdAt,
          sessionId: r.sessionId ?? '',
        }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }

  /**
   * 行为时间线：按天 / 会话检索「每轮做了什么」，按时间正序返回。
   * @param records 全部记忆
   * @param opts.date 可选，YYYY-MM-DD；不传则不限日期
   * @param opts.sessionId 可选，只看某个会话
   * @param limit 最多返回条数
   */
  timeline(records, opts = {}, limit = 200) {
    const { date, sessionId } = opts
    const dayStart = date ? parseTime(date) : null
    const dayEnd = dayStart != null ? dayStart + 86_400_000 : null
    return records
      .filter((r) => r.kind === 'turn')
      .filter((r) => !sessionId || r.sessionId === sessionId)
      .filter((r) => {
        if (dayStart == null) return true
        const t = r.occurredAt ?? r.createdAt ?? 0
        return t >= dayStart && t < dayEnd
      })
      .sort((a, b) => (a.occurredAt ?? a.createdAt ?? 0) - (b.occurredAt ?? b.createdAt ?? 0))
      .slice(0, limit)
  }

  /**
   * 清理工作记忆：默认不设条数上限（capacity = 0），只按 minRetentionMs 回收。
   * 年龄以「最后一次访问时间」为准——被召回会刷新 lastAccessedAt，从而延后清理。
   * 返回 { removed: string[], result: MemoryRecord[] }。
   */
  pruneWorking(records, { capacity = 0, minRetentionMs, ttlMs = 86_400_000 } = {}, now = Date.now()) {
    const minAge = minRetentionMs ?? ttlMs
    const working = records.filter((r) => r.layer === 'working' && !r.deletedAt)
    if (!working.length) return { removed: [], result: records }
    const touched = (r) => r.lastAccessedAt ?? r.occurredAt ?? r.createdAt ?? 0
    const byTime = working.slice().sort((a, b) => touched(b) - touched(a))
    const capped = capacity > 0 ? byTime.slice(0, capacity) : byTime
    const keep = new Set(capped.filter((r) => now - touched(r) <= minAge).map((r) => r.id))
    const removed = working.filter((r) => !keep.has(r.id)).map((r) => r.id)
    if (!removed.length) return { removed: [], result: records }
    return { removed, result: records.filter((r) => r.layer !== 'working' || keep.has(r.id)) }
  }

  // ------------------------------------------------------------------
  // 5. 巩固（只扫高价值情节记忆，合并成语义记忆）
  // ------------------------------------------------------------------

  /** 巩固：扫描高价值情节/工作记忆，相似的一组合并成语义记忆并归档源记忆。 */
  consolidate(records, now = Date.now()) {
    const cfg = this.settings.consolidation
    const highValue = records.filter((r) => {
      if (r.layer !== 'episodic' && r.layer !== 'working') return false
      if (r.archived || r.deletedAt) return false
      return this.strength(r, now) >= cfg.strengthThreshold || r.accessCount >= cfg.minAccessCount
    })

    const groups = []
    for (const r of highValue) {
      let placed = false
      for (const g of groups) {
        if (g.some((m) => similarity(m.content, r.content) >= cfg.mergeSimilarity)) {
          g.push(r)
          placed = true
          break
        }
      }
      if (!placed) groups.push([r])
    }

    let created = 0
    const out = [...records]
    for (const group of groups) {
      if (group.length < 2) continue
      const sorted = [...group].sort((a, b) => b.accessCount - a.accessCount)
      const summary = sorted.slice(0, 3).map((r) => r.content).join('；')
      const id = `semantic-${hashCode(summary)}`
      const mergedImportance = Math.max(...group.map((r) => r.importance))
      const semantic = {
        id,
        content: summary,
        layer: 'semantic',
        createdAt: now,
        occurredAt: Math.min(...group.map((r) => r.occurredAt ?? r.createdAt ?? now)),
        lastAccessedAt: now,
        accessCount: 0,
        mentionCount: 0,
        reviewHistory: [],
        importance: mergedImportance,
        factors: group[0].factors,
        dwellMs: group.reduce((s, r) => s + r.dwellMs, 0),
        archived: false,
      }
      for (const src of group) {
        const i = out.findIndex((m) => m.id === src.id)
        if (i >= 0) out[i] = { ...out[i], archived: cfg.archiveSource }
      }
      const existing = out.findIndex((m) => m.id === semantic.id)
      if (existing >= 0) out[existing] = semantic
      else out.push(semantic)
      created += 1
    }
    return { merged: highValue.length, created, result: out }
  }

  // ------------------------------------------------------------------
  // 6. 主动复习（找出临近期遗忘的记忆）
  // ------------------------------------------------------------------

  dueForReview(records, now = Date.now()) {
    const cfg = this.settings.review
    return records
      .filter((r) => {
        if (r.archived || r.deletedAt) return false
        // 相对阈值：保留率低于 dueThreshold 才算「临期遗忘」。
        // 这样低权重的工作记忆不会一上来就刷屏，而是按各自的衰减速度到期。
        const base = r.importance ?? 0
        return this.strength(r, now) < base * cfg.dueThreshold
      })
      .sort((a, b) => this.strength(a, now) - this.strength(b, now))
      .slice(0, cfg.maxPerBatch)
  }

  // ------------------------------------------------------------------
  // 7. 写入
  // ------------------------------------------------------------------

  write(input, existing, now = Date.now()) {
    const factors = { ...this.estimateFactors(input.content), ...(input.factors ?? {}) }
    const dwellMs = input.dwellMs ?? 0
    factors.dwell = clamp01(this.dwellFactor(dwellMs))
    // occurredAt = 事件真正发生的时间；缺省用写入时间
    const occurredAt = parseTime(input.occurredAt) ?? now
    const kind = input.kind ?? 'fact'
    // importance 可显式覆盖（工作记忆刻意用很低的值）
    const importance = input.importance != null ? clamp01(input.importance) : this.computeImportance(factors)

    if (existing) {
      const reinforced = this.reinforce(existing, now)
      return {
        ...reinforced,
        content: input.content,
        factors,
        dwellMs: existing.dwellMs + dwellMs,
        // 保留最早的「发生时间」，不因再次提起而覆盖
        occurredAt: existing.occurredAt ?? occurredAt,
        kind: existing.kind ?? kind,
      }
    }

    const baseId = hashCode(input.content)
    const record = {
      id: input.id ?? `mem-${baseId}`,
      content: input.content,
      layer: input.layer ?? 'episodic',
      kind,
      createdAt: now,
      occurredAt,
      lastAccessedAt: now,
      accessCount: 0,
      mentionCount: 0,
      reviewHistory: [now],
      importance,
      factors,
      dwellMs,
      archived: false,
    }
    if (input.sessionId) record.sessionId = input.sessionId
    if (input.turn != null) record.turn = input.turn
    return record
  }
}
