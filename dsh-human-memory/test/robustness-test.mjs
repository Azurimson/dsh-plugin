// test/robustness-test.mjs — 故障注入：损坏文件 / 损坏状态
// 运行：node test/robustness-test.mjs
import assert from 'node:assert'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
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

const home = mkdtempSync(join(tmpdir(), 'dsh-hm-robust-'))
process.env.DSH_HOME = home
const root = join(home, 'human-memory')

mkdirSync(join(root, 'memories', 'episodic'), { recursive: true })
writeFileSync(join(root, 'memories', 'episodic', 'ok.json'), JSON.stringify({ id: 'ok', content: '正常记录', layer: 'episodic' }))
writeFileSync(join(root, 'memories', 'episodic', 'bad.json'), '{ not json')
writeFileSync(join(root, 'state.json'), '{ broken')

const lib = new MemoryLibrary(root, 'memories.json', false, 999_999)

console.log('dsh-human-memory 故障注入实测\n')

check('损坏记忆文件被跳过', () => assert.strictEqual(lib.all().length, 1))
check('正常记录仍可读取', () => assert.strictEqual(lib.all()[0].content, '正常记录'))
check('损坏状态文件不影响启动', () => assert.strictEqual(typeof lib.state().lastConsolidationAt, 'number'))

lib.dispose()
rmSync(home, { recursive: true, force: true })

console.log(`\n结果：${passed} 通过，${failed} 失败`)
process.exit(failed ? 1 : 0)
