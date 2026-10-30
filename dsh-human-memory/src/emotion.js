// emotion.js — 轻量情绪识别（本地启发式，多信号加权）
// 不只看「开心/生气」这类显式词，还看语气词、标点、强调、重复、反问、emoji。
// 输出：{ kind, intensity, core, signals }

export const EMOTION_KINDS = ['joy', 'anger', 'sadness', 'surprise', 'fear', 'disgust', 'frustration', 'neutral']

const EXPLICIT = {
  joy: ['开心', '高兴', '快乐', '兴奋', '喜欢', '满意', '幸福', '惊喜', '期待', '太棒', '好耶', '爽', '舒服'],
  anger: ['生气', '愤怒', '火大', '恼火', '气死', '暴怒', '恨'],
  sadness: ['难过', '伤心', '沮丧', '失落', '失望', '郁闷', '委屈', '哭', '心累', '难受'],
  surprise: ['惊讶', '意外', '震惊', '没想到', '居然', '竟然', '天哪', '我的天'],
  fear: ['害怕', '恐惧', '担心', '焦虑', '紧张', '慌'],
  disgust: ['恶心', '讨厌', '反感', '嫌弃', '厌恶', '烦人'],
  frustration: ['无语', '服了', '醉了', '崩溃', '麻了', '破防', '离谱', '受不了', '无奈', '烦', '累', '摆烂', '裂开'],
}

const INTERJECTIONS = [
  '哦', '哇', '啊', '唉', '哎', '呀', '哈', '嗯', '哼', '咦', '呜', '靠', '卧槽',
  '天哪', '我的天', '绝了', '离谱', '服了', '无语', '麻了', '破防', '上头', '下头',
  '笑死', '哭死', '好家伙',
]

const INTENSIFIERS = ['太', '真', '特别', '非常', '超级', '巨', '简直', '完全', '根本', '竟然', '居然', '怎么', '这么', '那么', '无比', '极其']

const RHETORIC = ['不是吧', '这也行', '行吧', '随便', '呵呵', '就这', '怎么会', '凭什么', '不至于']

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u
const REPEAT_RE = /(.)\1{2,}/

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

function punctuationScore(text) {
  let s = 0
  s += Math.min((text.match(/[!！]/g) || []).length * 0.1, 0.3)
  s += Math.min((text.match(/…{2,}|\.{3,}/g) || []).length * 0.2, 0.2)
  s += Math.min((text.match(/[?？]/g) || []).length * 0.05, 0.1)
  s += Math.min((text.match(/[~～]/g) || []).length * 0.1, 0.1)
  return s
}

function extractCore(text, hitText) {
  if (!hitText) return ''
  const clauses = String(text).split(/[，。！？!?；;、\n]/).filter(Boolean)
  const found = clauses.find((c) => c.includes(hitText))
  return (found || clauses[0] || text).trim().slice(0, 80)
}

/**
 * 识别一段文本的情绪。
 * @param {string} text
 * @returns {{ kind: string, intensity: number, core: string, signals: Array<{kind:string,weight:number,text:string}> }}
 */
export function detectEmotion(text) {
  const t = String(text ?? '')
  if (!t.trim()) return { kind: 'neutral', intensity: 0, core: '', signals: [] }

  const signals = []
  let score = 0

  // 1) 显式情绪词（强信号）
  for (const [kind, words] of Object.entries(EXPLICIT)) {
    for (const w of words) {
      if (t.includes(w)) {
        score += 0.5
        signals.push({ kind, weight: 0.5, text: w })
      }
    }
  }

  // 2) 抱怨/重复模式：又…这样/这么/错/搞/忘/来/是
  if (/又[^，。！？!?]{0,6}(这样|这么|那样|错|搞|忘|来|是)/.test(t)) {
    score += 0.4
    signals.push({ kind: 'frustration', weight: 0.4, text: '又…' })
  }

  // 3) 语气词 / 感叹词
  for (const w of INTERJECTIONS) {
    if (t.includes(w)) {
      score += 0.3
      signals.push({ kind: 'surprise', weight: 0.3, text: w })
    }
  }

  // 4) 强调副词
  for (const w of INTENSIFIERS) {
    if (t.includes(w)) {
      score += 0.2
      signals.push({ kind: 'neutral', weight: 0.2, text: w })
    }
  }

  // 5) 反问 / 反讽
  for (const w of RHETORIC) {
    if (t.includes(w)) {
      score += 0.2
      signals.push({ kind: 'frustration', weight: 0.2, text: w })
    }
  }

  // 6) emoji
  if (EMOJI_RE.test(t)) {
    score += 0.2
    signals.push({ kind: 'joy', weight: 0.2, text: 'emoji' })
  }

  // 7) 重复 / 拖长（好好好、哈哈哈、啊啊啊）
  if (REPEAT_RE.test(t)) {
    score += 0.15
    signals.push({ kind: 'neutral', weight: 0.15, text: 'repetition' })
  }

  // 8) 标点
  const p = punctuationScore(t)
  if (p > 0) {
    signals.push({ kind: 'neutral', weight: p, text: 'punctuation' })
    score += p
  }

  const intensity = clamp01(1 - Math.exp(-score))

  // 定类：取权重最高的「非 neutral」信号
  let kind = 'neutral'
  let best = 0
  for (const s of signals) {
    if (s.kind === 'neutral') continue
    if (s.weight > best) {
      best = s.weight
      kind = s.kind
    }
  }
  const top = signals.find((s) => s.kind !== 'neutral' && s.weight === best)
  const core = extractCore(t, top && top.text)

  return { kind, intensity: Math.round(intensity * 1000) / 1000, core, signals }
}
