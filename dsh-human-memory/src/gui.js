// gui.js — 设置卡片的数据接口（注册到 DSH 内置 Web 服务器）
// 挂载前缀：/api/dsh-human-memory
//   GET  /api/dsh-human-memory/memories     记忆列表（按 importance 倒序，隐藏已软删除的）
//   POST /api/dsh-human-memory/delete       软删除一条记忆（进入删除缓冲区，下次巩固时真正删除）
//   POST /api/dsh-human-memory/open-folder  在文件管理器中打开记忆库目录
//   GET  /api/dsh-human-memory/health       健康检查
// 说明：这不是独立网页，也没有自己的端口；路由由 DSH 的 webServer 统一承载。

import { exec } from 'node:child_process'

export const ROUTE_PREFIX = '/api/dsh-human-memory'

/** 在系统文件管理器中打开目录。 */
export function openFolderInExplorer(dir) {
  const cmd =
    process.platform === 'win32'
      ? `explorer.exe "${dir}"`
      : process.platform === 'darwin'
        ? `open "${dir}"`
        : `xdg-open "${dir}"`
  exec(cmd, () => {
    /* 打不开也不影响插件 */
  })
}

/** 读取 JSON 请求体；失败返回 null。 */
function readBody(req) {
  return new Promise((resolve) => {
    let data = ''
    if (!req || typeof req.on !== 'function') {
      resolve(null)
      return
    }
    req.on('data', (chunk) => {
      data += chunk
    })
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : null)
      } catch {
        resolve(null)
      }
    })
    req.on('error', () => resolve(null))
  })
}

/**
 * 在 DSH 的 webServer 上注册本插件的记忆接口。
 * @param {object} opts
 * @param {{ register?: Function }} opts.server DSH webServer 服务
 * @param {() => object[]} opts.getMemories 返回全部记忆
 * @param {(id: string) => boolean} [opts.markDeleted] 软删除一条记忆
 * @param {string} opts.rootDir 记忆库根目录
 * @param {(msg: string) => void} [opts.logger]
 * @returns {(() => void) | null} disposer（若 server 可用）
 */
export function registerMemoryRoutes(opts) {
  const { server, getMemories, markDeleted, listTrash, restoreFromTrash, rootDir, logger } = opts
  if (!server || typeof server.register !== 'function') return null

  const handler = async (req, res) => {
    const raw = String((req && (req.url || req.path)) || '')
    const pathname = raw.split('?')[0].split('#')[0]
    const rest = pathname.startsWith(ROUTE_PREFIX) ? pathname.slice(ROUTE_PREFIX.length) : pathname
    const head = rest.replace(/^\/+/, '').split('/')[0]
    const method = String((req && req.method) || 'GET').toUpperCase()

    const send = (code, body) => {
      try {
        if (res && typeof res.writeHead === 'function') {
          res.writeHead(code, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          })
          res.end(body === undefined ? '' : JSON.stringify(body))
          return
        }
        if (res && typeof res.setHeader === 'function' && typeof res.end === 'function') {
          res.statusCode = code
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.setHeader('cache-control', 'no-store')
          res.end(body === undefined ? '' : JSON.stringify(body))
        }
      } catch {
        /* 响应写失败不影响后续 */
      }
    }

    // 写操作只接受 JSON（避免普通表单/图片触发本机回环请求）
    if (method === 'POST') {
      const ct = String((req && req.headers && req.headers['content-type']) || '')
      if (!ct.includes('application/json')) {
        send(415, { error: 'unsupported-media-type' })
        return
      }
    }

    if (head === 'memories' && method === 'GET') {
      let memories = []
      try {
        memories = getMemories() || []
      } catch (err) {
        logger?.('读取记忆失败：' + err)
      }
      const visible = memories.filter((m) => !m.deletedAt)
      const sorted = visible.slice().sort((a, b) => (b.importance || 0) - (a.importance || 0))
      send(200, { memories: sorted })
      return
    }

    if (head === 'delete' && method === 'POST') {
      const body = await readBody(req)
      const id = body && body.id
      if (!id) {
        send(400, { error: 'missing-id' })
        return
      }
      const rec = (getMemories() || []).find((m) => m.id === id)
      if (!rec) {
        send(404, { error: 'not-found' })
        return
      }
      if (typeof markDeleted !== 'function' || !markDeleted(id)) {
        send(500, { error: 'not-supported' })
        return
      }
      // 软删除：立即从列表消失，真正删除发生在下一次巩固
      send(200, { ok: true, id, buffered: true })
      return
    }

    if (head === 'trash' && method === 'GET') {
      const items = typeof listTrash === 'function' ? listTrash() : []
      const sorted = items.slice().sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0))
      send(200, { memories: sorted })
      return
    }

    if (head === 'restore' && method === 'POST') {
      const body = await readBody(req)
      const id = body && body.id
      if (!id) {
        send(400, { error: 'missing-id' })
        return
      }
      if (typeof restoreFromTrash !== 'function' || !restoreFromTrash(id)) {
        send(404, { error: 'not-found' })
        return
      }
      send(200, { ok: true, id })
      return
    }

    if (head === 'open-folder' && method === 'POST') {
      openFolderInExplorer(rootDir)
      send(200, { ok: true, path: rootDir })
      return
    }

    if (head === 'health') {
      send(200, { ok: true, rootDir })
      return
    }

    send(404, { error: 'not-found' })
  }

  return server.register({ kind: 'prefix', path: ROUTE_PREFIX, handler })
}
