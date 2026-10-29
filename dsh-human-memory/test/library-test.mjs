// test/library-test.mjs — 目录式记忆库与旧版迁移自测
// 测 src/store.js（只依赖 Node 内置模块），不依赖 DSH。
// 运行：node test/library-test.mjs
import assert from 'node:assert'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryLibrary } from '../src/store.js'

let passed = 0
let failed = 0
function check(name, fn) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failed++
    console.log(`  ✗ ${name}`)
    console.log(`    ${err?.message ?? err}`)
  }
}

const home = mkdtempSync(join(tmpdir(), 'dsh-hm-lib-'))
process.env.DSH_HOME = home
const root = join(home, 'human-memory')

// 构造一份旧版单文件记忆库（记录没有 occurredAt）
mkdirSync(root, { recursive: true })
const legacy = {
  version: 1,
  memories: [
    {
      id: 'mem-old',
      content: '旧版记忆：项目用 Python 和 Vue',
      layer: 'semantic',
      createdAt: 1_700_000_000_000,
      lastAccessedAt: 1_700_000_000_000,
      accessCount: 2,
      mentionCount: 0,
      reviewHistory: [1_700_000_000_000],
      importance: 0.5,
      factors: {},
      dwellMs: 0,
      archived: false,
    },
  ],
}
writeFileSync(join(root, 'memories.json'), JSON.stringify(legacy), 'utf8')

console.log('dsh-human-memory 记忆库自测\n')

// 构造会触发迁移 + 加载
const lib = new MemoryLibrary(root, 'memories.json', false, 999_999)

check('旧 memories.json 已备份为 .bak', () => assert(existsSync(join(root, 'memories.json.bak'))))
check('旧记录补齐 occurredAt', () => assert.strictEqual(lib.all()[0].occurredAt, 1_700_000_000_000))
check('生成 memories/semantic 目录', () => assert(existsSync(join(root, 'memories', 'semantic'))))
check('语义记忆独立成文件', () => assert(existsSync(join(root, 'memories', 'semantic', 'mem-old.json'))))
check('生成 index.json 索引', () => assert(existsSync(join(root, 'index.json'))))

check('索引含日期与文件路径', () => {
  const idx = JSON.parse(readFileSync(join(root, 'index.json'), 'utf8'))
  assert(Array.isArray(idx.memories) && idx.memories.length === 1)
  assert.strictEqual(typeof idx.memories[0].occurredAt, 'number')
  assert(idx.memories[0].file.includes('memories/semantic/'))
})

// 新增一条并落盘
lib.upsert({
  id: 'mem-new',
  content: '新记忆：部署在本地',
  layer: 'episodic',
  createdAt: 1_700_000_100_000,
  occurredAt: 1_700_000_100_000,
  lastAccessedAt: 1_700_000_100_000,
  accessCount: 0,
  mentionCount: 0,
  reviewHistory: [1_700_000_100_000],
  importance: 0.4,
  factors: {},
  dwellMs: 0,
  archived: false,
})
lib.dispose()

check('新记忆按层写入文件', () => assert(existsSync(join(root, 'memories', 'episodic', 'mem-new.json'))))

// 删除并落盘
const lib2 = new MemoryLibrary(root, 'memories.json', false, 999_999)
check('重启后能加载回两条', () => assert.strictEqual(lib2.all().length, 2))
lib2.remove('mem-new')
lib2.dispose()
check('删除后文件被移除', () => assert(!existsSync(join(root, 'memories', 'episodic', 'mem-new.json'))))

// 删除缓冲区：移入 / 恢复 / 真正删除
const trashRec = {
  id: 'mem-trash',
  content: '待删除的记忆',
  layer: 'episodic',
  createdAt: 1_700_000_200_000,
  occurredAt: 1_700_000_200_000,
  lastAccessedAt: 1_700_000_200_000,
  accessCount: 0,
  mentionCount: 0,
  reviewHistory: [1_700_000_200_000],
  importance: 0.3,
  factors: {},
  dwellMs: 0,
  archived: false,
}
const lib3 = new MemoryLibrary(root, 'memories.json', false, 999_999)
lib3.upsert(trashRec)

check('移入删除缓冲区成功', () => assert.strictEqual(lib3.moveToTrash('mem-trash'), true))
check('文件已移入 trash/ 文件夹', () => assert(existsSync(join(root, 'trash', 'mem-trash.json'))))
check('当前记忆区不再包含它', () => assert(!lib3.all().some((m) => m.id === 'mem-trash')))
check('listTrash 能列出', () => assert(lib3.listTrash().some((m) => m.id === 'mem-trash')))

check('restoreFromTrash 能恢复', () => {
  assert.strictEqual(lib3.restoreFromTrash('mem-trash'), true)
  assert(lib3.all().some((m) => m.id === 'mem-trash'))
  assert(!existsSync(join(root, 'trash', 'mem-trash.json')))
})

lib3.moveToTrash('mem-trash')
const purged = lib3.purgeTrash()
lib3.dispose()
check('purgeTrash 清空缓冲区', () => {
  assert(purged >= 1)
  assert(!existsSync(join(root, 'trash', 'mem-trash.json')))
})

console.log(`\n结果：${passed} 通过，${failed} 失败`)
rmSync(home, { recursive: true, force: true })
process.exit(failed ? 1 : 0)
