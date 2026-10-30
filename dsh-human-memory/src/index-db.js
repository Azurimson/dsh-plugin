// index-db.js — 基于 Node 内置 node:sqlite 的记忆索引（零额外构建）
// 文件仍是唯一真源；本模块只是可重建的加速索引，用于「某天 / 某会话做了什么」的快速查询。
// 若 node:sqlite 不可用，所有方法安静降级为空结果，不影响文件存储。

import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  layer TEXT NOT NULL,
  kind TEXT,
  fidelity TEXT,
  session_id TEXT,
  occurred_at INTEGER NOT NULL,
  importance REAL,
  emotion_kind TEXT,
  emotion_intensity REAL,
  gist TEXT,
  details_json TEXT,
  deleted_at INTEGER,
  mtime INTEGER,
  size INTEGER
);
CREATE INDEX IF NOT EXISTS idx_time         ON memories(occurred_at);
CREATE INDEX IF NOT EXISTS idx_session_time ON memories(session_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_emotion      ON memories(emotion_kind, occurred_at);
CREATE INDEX IF NOT EXISTS idx_layer_time   ON memories(layer, occurred_at);
CREATE INDEX IF NOT EXISTS idx_fidelity     ON memories(fidelity, occurred_at);
`

export class MemoryIndex {
  constructor(dbPath) {
    this.dbPath = dbPath
    this.available = false
    this.db = null
    try {
      mkdirSync(dirname(dbPath), { recursive: true })
      this.db = new DatabaseSync(dbPath)
      this.db.exec(SCHEMA)
      this.upsertStmt = this.db.prepare(`
        INSERT INTO memories (
          id, path, layer, kind, fidelity, session_id, occurred_at, importance,
          emotion_kind, emotion_intensity, gist, details_json, deleted_at, mtime, size
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          path=excluded.path, layer=excluded.layer, kind=excluded.kind, fidelity=excluded.fidelity,
          session_id=excluded.session_id, occurred_at=excluded.occurred_at, importance=excluded.importance,
          emotion_kind=excluded.emotion_kind, emotion_intensity=excluded.emotion_intensity,
          gist=excluded.gist, details_json=excluded.details_json, deleted_at=excluded.deleted_at,
          mtime=excluded.mtime, size=excluded.size
      `)
      this.removeStmt = this.db.prepare('DELETE FROM memories WHERE id = ?')
      this.clearStmt = this.db.prepare('DELETE FROM memories')
      this.available = true
    } catch (err) {
      console.warn('[dsh-human-memory] SQLite 索引不可用，退回文件扫描：', err?.message ?? err)
    }
  }

  upsert(record, relPath, stat) {
    if (!this.available) return
    try {
      this.upsertStmt.run(
        record.id,
        relPath,
        record.layer ?? 'episodic',
        record.kind ?? 'fact',
        record.fidelity ?? 'gist',
        record.sessionId ?? null,
        record.occurredAt ?? record.createdAt ?? Date.now(),
        record.importance ?? 0,
        record.emotionKind ?? 'neutral',
        record.emotionIntensity ?? 0,
        record.content ?? '',
        JSON.stringify(record.details ?? []),
        record.deletedAt ?? null,
        stat?.mtime ?? null,
        stat?.size ?? null,
      )
    } catch (err) {
      console.warn('[dsh-human-memory] 索引写入失败：', err?.message ?? err)
    }
  }

  remove(id) {
    if (!this.available) return
    try {
      this.removeStmt.run(id)
    } catch (err) {
      console.warn('[dsh-human-memory] 索引删除失败：', err?.message ?? err)
    }
  }

  /** 用内存中的全部记录重建索引。 */
  rebuild(records, pathFor) {
    if (!this.available) return 0
    try {
      this.clearStmt.run()
      for (const r of records) this.upsert(r, pathFor(r))
      return records.length
    } catch (err) {
      console.warn('[dsh-human-memory] 索引重建失败：', err?.message ?? err)
      return 0
    }
  }

  /** 查询某天（[start, end) 毫秒区间）的记录。 */
  queryDay(start, end, { fidelity = 'gist' } = {}) {
    if (!this.available) return []
    try {
      return this.db
        .prepare('SELECT * FROM memories WHERE occurred_at >= ? AND occurred_at < ? AND fidelity = ? ORDER BY occurred_at')
        .all(start, end, fidelity)
    } catch (err) {
      console.warn('[dsh-human-memory] 按天查询失败：', err?.message ?? err)
      return []
    }
  }

  /** 查询某个会话的记录。 */
  querySession(sessionId, { fidelity = 'gist' } = {}) {
    if (!this.available) return []
    try {
      return this.db
        .prepare('SELECT * FROM memories WHERE session_id = ? AND fidelity = ? ORDER BY occurred_at')
        .all(sessionId, fidelity)
    } catch (err) {
      console.warn('[dsh-human-memory] 按会话查询失败：', err?.message ?? err)
      return []
    }
  }

  stats() {
    if (!this.available) return { available: false, count: 0 }
    try {
      const row = this.db.prepare('SELECT COUNT(*) AS n FROM memories').get()
      return { available: true, count: row?.n ?? 0 }
    } catch {
      return { available: true, count: 0 }
    }
  }

  close() {
    try {
      this.db?.close()
    } catch {
      /* ignore */
    }
  }
}
