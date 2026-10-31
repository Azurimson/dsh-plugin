// persona.js — 人格参数网（注意 / 提取 / 解释 / 表达）
// 人格不是记忆结构，而是一组权重：决定「先想起什么、忽略什么、怎么解释」。
// 记忆侧只承接注意、提取、解释三项；行动倾向与表达抑制由上层使用。

export const DEFAULT_PERSONA = {
  // 注意选择：某类线索在回忆时被优先关注
  attention: { person: 1, place: 1, topic: 1, time: 1, emotion: 1 },
  // 提取偏向：某个脑区的记忆更容易被想起
  retrieval: {
    working: 0.6,
    episodic: 1,
    semantic: 1,
    emotional: 1,
    procedural: 1,
    autobiographical: 1,
  },
  // 解释偏向：交给模型的「框架」提示（记忆侧只给素材，不替代模型判断）
  interpretation: { logic: 0.5, warmth: 0.5, caution: 0.5 },
  // 表达抑制：最终呈现方式
  expression: { directness: 0.5, verbosity: 0.5 },
}

const clone = (v) => JSON.parse(JSON.stringify(v))
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

/** 深度合并两层的参数网，数值裁剪到 [0, 2]。 */
export function mergePersona(base, override) {
  const out = clone(base ?? DEFAULT_PERSONA)
  if (!override || typeof override !== 'object') return out
  for (const group of Object.keys(out)) {
    if (!override[group] || typeof override[group] !== 'object') continue
    for (const [k, v] of Object.entries(override[group])) {
      if (typeof v === 'number' && Number.isFinite(v)) out[group][k] = clamp(v, 0, 2)
    }
  }
  return out
}

/** 依次叠加：默认值 → settings.persona → persona.json（后者优先）。 */
export function loadPersona(settings, filePersona) {
  return mergePersona(mergePersona(DEFAULT_PERSONA, settings?.persona), filePersona)
}

/** 按 `interpretation.logic` 这样的路径写入一个参数。 */
export function setPersonaPath(persona, path, value) {
  const parts = String(path ?? '').split('.')
  if (parts.length < 2) return false
  let obj = persona
  for (let i = 0; i < parts.length - 1; i++) {
    obj = obj?.[parts[i]]
    if (!obj || typeof obj !== 'object') return false
  }
  const key = parts[parts.length - 1]
  if (!(key in obj)) return false
  const n = Number(value)
  if (!Number.isFinite(n)) return false
  obj[key] = clamp(n, 0, 2)
  return true
}

/** 反馈里的 trait 名 → 参数路径。 */
const TRAIT_PATH = {
  logic: 'interpretation.logic',
  warmth: 'interpretation.warmth',
  caution: 'interpretation.caution',
  directness: 'expression.directness',
  verbosity: 'expression.verbosity',
  attention_person: 'attention.person',
  attention_place: 'attention.place',
  attention_topic: 'attention.topic',
  attention_time: 'attention.time',
  attention_emotion: 'attention.emotion',
  retrieval_working: 'retrieval.working',
  retrieval_episodic: 'retrieval.episodic',
  retrieval_semantic: 'retrieval.semantic',
  retrieval_emotional: 'retrieval.emotional',
  retrieval_procedural: 'retrieval.procedural',
  retrieval_autobiographical: 'retrieval.autobiographical',
}

export function feedbackTraitPath(trait) {
  return TRAIT_PATH[String(trait ?? '').toLowerCase()] ?? null
}

/**
 * 从反馈记忆推导人格参数的建议增量。
 * 每条反馈 +step 或 -step，同一路径累计后被 cap 截断。
 */
export function suggestPersonaDeltas(feedbackRecords, { step = 0.05, cap = 0.2 } = {}) {
  const deltas = {}
  for (const r of feedbackRecords ?? []) {
    const path = feedbackTraitPath(r.trait)
    if (!path) continue
    const dir = String(r.direction ?? '').toLowerCase() === 'decrease' ? -1 : 1
    deltas[path] = clamp((deltas[path] ?? 0) + dir * step, -cap, cap)
  }
  return deltas
}
