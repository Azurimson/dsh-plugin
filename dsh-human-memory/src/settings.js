// settings.js — 配置文件加载与默认值
// 从插件根目录下的 settings.json（JSONC，支持 // 注释）读取用户配置，
// 与内置默认值深度合并，避免用户漏配某字段时崩溃。

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 内置默认值。用户配置文件缺失的字段会回退到这里。 */
export const DEFAULT_SETTINGS = {
  storage: {
    dataDir: '',
    fileName: 'memories.json',
    syncWrite: false,
    flushIntervalMs: 5000,
  },
  forgetting: {
    tauMs: 86_400_000,
    c: 0.3,
    usePowerLaw: false,
    powerBeta: 0.2,
  },
  importance: {
    selfRelevance: 0.25,
    causality: 0.15,
    concreteness: 0.15,
    uniqueness: 0.15,
    emotion: 0.1,
    dwell: 0.2,
    dwellRefMs: 60_000,
  },
  retrieval: {
    relevance: 0.5,
    strength: 0.3,
    importance: 0.2,
  },
  spacing: {
    kappa: 0.3,
    spacingTauMs: 86_400_000,
    reinforce: 0.05,
    maxImportance: 1.0,
  },
  consolidation: {
    autoOnTurnEnd: true,
    strengthThreshold: 0.6,
    minAccessCount: 2,
    mergeSimilarity: 0.5,
    archiveSource: true,
  },
  review: {
    mode: 'manual',
    dueThreshold: 0.4,
    minIntervalMs: 3_600_000,
    maxPerBatch: 5,
  },
  workingMemory: {
    capacity: 7,
  },
}

/**
 * 去除 JSONC 文本中的 // 行注释与块注释。
 * 用逐字符状态机识别字符串字面量，避免误删字符串里的 "//" 或 "/*"。
 */
export function stripJsonComments(text) {
  let out = ''
  let i = 0
  let inString = false
  let stringChar = ''
  while (i < text.length) {
    const ch = text[i]
    const next = text[i + 1]

    if (inString) {
      out += ch
      if (ch === '\\') {
        out += next ?? ''
        i += 2
        continue
      }
      if (ch === stringChar) inString = false
      i += 1
      continue
    }

    if (ch === '"' || ch === "'") {
      inString = true
      stringChar = ch
      out += ch
      i += 1
      continue
    }

    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i + 1 < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1
      i += 2
      continue
    }

    out += ch
    i += 1
  }
  return out
}

/** 浅层递归合并：用户值优先，缺省回退默认值。 */
function mergeDeep(base, override) {
  if (typeof override !== 'object' || override === null) return base
  const out = { ...base }
  for (const key of Object.keys(override)) {
    const bv = base[key]
    const ov = override[key]
    if (typeof bv === 'object' && bv !== null && !Array.isArray(bv) && typeof ov === 'object' && ov !== null) {
      out[key] = mergeDeep(bv, ov)
    } else if (ov !== undefined) {
      out[key] = ov
    }
  }
  return out
}

/**
 * 加载配置。优先读取插件根目录旁的 settings.json；
 * 不存在或解析失败时使用默认值（并打印一次警告）。
 */
export function loadSettings(settingsPath) {
  let raw = ''
  if (settingsPath) {
    raw = readFileSync(settingsPath, 'utf8')
  } else {
    try {
      // 本文件位于 src/settings.js，向上两级即插件根目录，settings.json 就在那里。
      const here = fileURLToPath(import.meta.url)
      const root = dirname(dirname(here))
      raw = readFileSync(join(root, 'settings.json'), 'utf8')
    } catch {
      // 无配置文件，直接走默认值
      return structuredClone(DEFAULT_SETTINGS)
    }
  }

  try {
    const parsed = JSON.parse(stripJsonComments(raw))
    return mergeDeep(DEFAULT_SETTINGS, parsed)
  } catch (err) {
    console.warn('[dsh-human-memory] settings.json 解析失败，已回退默认配置：', err)
    return structuredClone(DEFAULT_SETTINGS)
  }
}
