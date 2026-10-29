// store.js — 本地 JSON 文件存储
// 记忆全部存在本地（本插件不联网）。以单个 JSON 文件持久化所有记忆记录，
// 提供原子写入（先写临时文件再 rename），避免中途崩溃损坏数据。

import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'

/** 解析存储目录：优先 $DSH_HOME，其次用户配置 dataDir，最后 ~/.dsh。 */
export function resolveDataDir(dataDir) {
  if (dataDir) return dataDir
  const dshHome = process.env.DSH_HOME
  if (dshHome) return join(dshHome, 'human-memory')
  return join(homedir(), '.dsh', 'human-memory')
}

export class MemoryStore {
  constructor(dataDir, fileName, syncWrite, flushIntervalMs) {
    this.filePath = join(resolveDataDir(dataDir), fileName)
    this.syncWrite = syncWrite
    this.memories = []
    this.dirty = false
    this.flushTimer = null
    this.load()
    if (!syncWrite) {
      this.flushTimer = setInterval(() => this.flush(), flushIntervalMs)
      this.flushTimer.unref?.()
      process.once('beforeExit', () => this.flush())
    }
  }

  /** 从磁盘加载，文件不存在时从空开始。 */
  load() {
    try {
      if (!existsSync(this.filePath)) return
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8'))
      if (Array.isArray(parsed?.memories)) this.memories = parsed.memories
    } catch (err) {
      console.warn('[dsh-human-memory] 记忆数据文件读取失败，将从空记忆开始：', err)
      this.memories = []
    }
  }

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
    this.markDirty()
  }

  remove(id) {
    const idx = this.memories.findIndex((m) => m.id === id)
    if (idx < 0) return false
    this.memories.splice(idx, 1)
    this.markDirty()
    return true
  }

  /** 批量替换（巩固归档后整组写回）。 */
  replaceAll(records) {
    this.memories = records
    this.markDirty()
  }

  markDirty() {
    this.dirty = true
    if (this.syncWrite) this.flush()
  }

  /** 落盘：先写临时文件再原子替换。 */
  flush() {
    if (!this.dirty) return
    const payload = { version: 1, memories: this.memories }
    try {
      mkdirSync(dirname(this.filePath), { recursive: true })
      const tmp = `${this.filePath}.tmp`
      writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8')
      renameSync(tmp, this.filePath)
      this.dirty = false
    } catch (err) {
      console.warn('[dsh-human-memory] 记忆落盘失败：', err)
    }
  }

  dispose() {
    if (this.flushTimer) clearInterval(this.flushTimer)
    this.flush()
  }
}
