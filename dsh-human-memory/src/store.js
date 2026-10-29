// store.js — 本地记忆库（目录式存储）
// 记忆全部存在本地（本插件不联网）。结构：
//   <root>/index.json                    人类可读的索引（含日期、重要性、内容预览）
//   <root>/memories/episodic/<id>.json   每条记忆一个文件
//   <root>/memories/semantic/<id>.json
//   <root>/memories/core/<id>.json
// 每条记忆独立成文件：避免整库重写、便于单独查看/备份/迁移。
// 落盘使用「临时文件 + rename」保证单文件原子性。

import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  readdirSync,
  unlinkSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'

/** 解析记忆库根目录：优先 $DSH_HOME，其次用户配置 dataDir，最后 ~/.dsh。 */
export function resolveDataDir(dataDir) {
  if (dataDir) return dataDir
  const dshHome = process.env.DSH_HOME
  if (dshHome) return join(dshHome, 'human-memory')
  return join(homedir(), '.dsh', 'human-memory')
}

const LAYERS = ['episodic', 'semantic', 'core']

export class MemoryLibrary {
  constructor(dataDir, fileName, syncWrite, flushIntervalMs) {
    this.rootDir = resolveDataDir(dataDir)
    this.legacyName = fileName || 'memories.json'
    this.memoriesDir = join(this.rootDir, 'memories')
    this.indexPath = join(this.rootDir, 'index.json')
    this.syncWrite = syncWrite
    this.memories = []
    this.persisted = new Map() // id -> 上次写入的文件路径
    this.dirty = new Set()
    this.removed = new Set()
    this.flushTimer = null

    this.load()
    if (!syncWrite) {
      this.flushTimer = setInterval(() => this.flush(), flushIntervalMs)
      this.flushTimer.unref?.()
      process.once('beforeExit', () => this.flush())
    }
  }

  // ------------------------------------------------------------------
  // 加载
  // ------------------------------------------------------------------

  load() {
    const legacy = join(this.rootDir, this.legacyName)
    if (existsSync(legacy)) {
      this.migrateLegacy(legacy)
    }
    this.loadRecords()
  }

  /** 把旧版单文件 memories.json 拆分到新的 memories/ 目录，并备份原文件。 */
  migrateLegacy(legacy) {
    try {
      const parsed = JSON.parse(readFileSync(legacy, 'utf8'))
      if (Array.isArray(parsed?.memories)) {
        for (const r of parsed.memories) {
          if (!r || typeof r.id !== 'string') continue
          // 旧版记录没有 occurredAt，用 createdAt 补齐
          if (r.occurredAt == null) r.occurredAt = r.createdAt ?? Date.now()
          this.memories.push(r)
          this.dirty.add(r.id)
        }
      }
      renameSync(legacy, `${legacy}.bak`)
      this.flush() // 立即写新结构
      console.log(`[dsh-human-memory] 已迁移旧记忆库到目录结构（${this.memories.length} 条），原文件备份为 ${this.legacyName}.bak`)
    } catch (err) {
      console.warn('[dsh-human-memory] 旧记忆库迁移失败，将跳过：', err)
    }
  }

  /** 扫描 memories/<layer>/*.json 加载所有记录。 */
  loadRecords() {
    if (!existsSync(this.memoriesDir)) return
    for (const layer of LAYERS) {
      const dir = join(this.memoriesDir, layer)
      if (!existsSync(dir)) continue
      let files = []
      try {
        files = readdirSync(dir).filter((f) => f.endsWith('.json'))
      } catch {
        continue
      }
      for (const file of files) {
        const p = join(dir, file)
        try {
          const rec = JSON.parse(readFileSync(p, 'utf8'))
          if (!rec || typeof rec.id !== 'string') continue
          // 同一 id 去重（迁移可能产生重复）
          const idx = this.memories.findIndex((m) => m.id === rec.id)
          if (idx >= 0) this.memories[idx] = rec
          else this.memories.push(rec)
          this.persisted.set(rec.id, p)
        } catch (err) {
          console.warn(`[dsh-human-memory] 跳过损坏的记忆文件 ${p}：`, err)
        }
      }
    }
  }

  // ------------------------------------------------------------------
  // 读写 API
  // ------------------------------------------------------------------

  all() {
    return this.memories
  }

  get(id) {
    return this.memories.find((m) => m.id === id)
  }

  upsert(record) {
    const idx = this.memories.findIndex((m) => m.id === record.id)
    if (idx >= 0) this.memories[idx] = record
    else this.memories.push(record)
    this.dirty.add(record.id)
    this.removed.delete(record.id)
    if (this.syncWrite) this.flush()
  }

  remove(id) {
    const idx = this.memories.findIndex((m) => m.id === id)
    if (idx < 0) return false
    this.memories.splice(idx, 1)
    this.dirty.delete(id)
    this.removed.add(id)
    if (this.syncWrite) this.flush()
    return true
  }

  /** 批量替换（巩固后整组写回）。 */
  replaceAll(records) {
    const newIds = new Set(records.map((r) => r.id))
    for (const old of this.memories) {
      if (!newIds.has(old.id)) this.removed.add(old.id)
    }
    this.memories = records
    for (const r of records) this.dirty.add(r.id)
    if (this.syncWrite) this.flush()
  }

  // ------------------------------------------------------------------
  // 落盘
  // ------------------------------------------------------------------

  fileFor(record) {
    return join(this.memoriesDir, record.layer, `${record.id}.json`)
  }

  flush() {
    if (!this.dirty.size && !this.removed.size) return
    try {
      // 删除
      for (const id of this.removed) {
        const p = this.persisted.get(id)
        if (p && existsSync(p)) unlinkSync(p)
        this.persisted.delete(id)
      }
      // 写入（按 layer 分目录）
      for (const id of this.dirty) {
        const rec = this.get(id)
        if (!rec) continue
        const target = this.fileFor(rec)
        const prev = this.persisted.get(id)
        if (prev && prev !== target && existsSync(prev)) unlinkSync(prev)
        mkdirSync(dirname(target), { recursive: true })
        this.writeAtomic(target, JSON.stringify(rec, null, 2))
        this.persisted.set(id, target)
      }
      this.dirty.clear()
      this.removed.clear()
      this.writeIndex()
    } catch (err) {
      console.warn('[dsh-human-memory] 记忆落盘失败：', err)
    }
  }

  writeAtomic(path, text) {
    const tmp = `${path}.tmp`
    writeFileSync(tmp, text, 'utf8')
    renameSync(tmp, path)
  }

  /** 写人类可读索引（含日期），便于直接浏览记忆库。 */
  writeIndex() {
    const index = this.memories.map((m) => ({
      id: m.id,
      layer: m.layer,
      occurredAt: m.occurredAt ?? m.createdAt,
      lastAccessedAt: m.lastAccessedAt,
      importance: Number((m.importance ?? 0).toFixed(3)),
      archived: !!m.archived,
      preview: String(m.content ?? '').slice(0, 60),
      file: `memories/${m.layer}/${m.id}.json`,
    }))
    const payload = { version: 2, count: index.length, memories: index }
    mkdirSync(this.rootDir, { recursive: true })
    this.writeAtomic(this.indexPath, JSON.stringify(payload, null, 2))
  }

  dispose() {
    if (this.flushTimer) clearInterval(this.flushTimer)
    this.flush()
  }
}
