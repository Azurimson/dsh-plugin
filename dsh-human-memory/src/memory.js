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

  // ------------------------------------------------------------------
  // 4. 检索（综合相关度 + 强度 + 重要性排序）
  // ------------------------------------------------------------------

  recall(records, query, limit = 10, now = Date.now()) {
    const w = this.retWeights
    return records
      .filter((r) => !r.archived)
      .map((r) => {
        const relevance = similarity(query, r.content)
        const s = this.strength(r, now)
        const score = w.relevance * relevance + w.strength * s + w.importance * r.importance
        return { id: r.id, content: r.content, layer: r.layer, score, strength: s, relevance, importance: r.importance }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }

  // ------------------------------------------------------------------
  // 5. 巩固（只扫高价值情节记忆，合并成语义记忆）
  // ------------------------------------------------------------------

  /** 巩固：只扫高价值情节记忆，相似的一组合并成语义记忆并归档源记忆。 */
  consolidate(records, now = Date.now()) {
    const cfg = this.settings.consolidation
    const highValue = records.filter((r) => {
      if (r.layer !== 'episodic') return false
      if (r.archived) return false
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
      .filter((r) => !r.archived && this.strength(r, now) < cfg.dueThreshold)
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

    if (existing) {
      const reinforced = this.reinforce(existing, now)
      return { ...reinforced, content: input.content, factors, dwellMs: existing.dwellMs + dwellMs }
    }

    const baseId = hashCode(input.content)
    return {
      id: `mem-${baseId}`,
      content: input.content,
      layer: input.layer ?? 'episodic',
      createdAt: now,
      lastAccessedAt: now,
      accessCount: 0,
      mentionCount: 0,
      reviewHistory: [now],
      importance: this.computeImportance(factors),
      factors,
      dwellMs,
      archived: false,
    }
  }
}
