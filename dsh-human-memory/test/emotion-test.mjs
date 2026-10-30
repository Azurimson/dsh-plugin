// test/emotion-test.mjs — 情绪识别实测
// 运行：node test/emotion-test.mjs
import assert from 'node:assert'
import { detectEmotion } from '../src/emotion.js'

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

console.log('dsh-human-memory 情绪识别实测\n')

check('显式情绪词：开心', () => {
  const e = detectEmotion('今天真开心！')
  assert.strictEqual(e.kind, 'joy')
  assert(e.intensity > 0.4, `intensity=${e.intensity}`)
})

check('语气词 + 抱怨模式：哇你又犯错了', () => {
  const e = detectEmotion('哇你又犯错了')
  assert.strictEqual(e.kind, 'frustration')
  assert(e.intensity > 0.2, `intensity=${e.intensity}`)
})

check('感叹号 + 强调：你怎么又这样！！！', () => {
  const e = detectEmotion('你怎么又这样！！！')
  assert(e.intensity > 0.4, `intensity=${e.intensity}`)
  assert(['anger', 'frustration'].includes(e.kind), `kind=${e.kind}`)
})

check('省略号：……好吧', () => {
  const e = detectEmotion('……好吧')
  assert(e.intensity > 0.1, `intensity=${e.intensity}`)
})

check('反问：不是吧，这也行？', () => {
  const e = detectEmotion('不是吧，这也行？')
  assert(e.intensity > 0.2, `intensity=${e.intensity}`)
  assert.strictEqual(e.kind, 'frustration')
})

check('重复/拖长：好好好', () => {
  const e = detectEmotion('好好好')
  assert(e.intensity > 0.1, `intensity=${e.intensity}`)
})

check('中性文本强度低', () => {
  const e = detectEmotion('这个文件放在桌面')
  assert(e.intensity < 0.2, `intensity=${e.intensity}`)
})

check('空文本返回 neutral / 0', () => {
  const e = detectEmotion('')
  assert.strictEqual(e.kind, 'neutral')
  assert.strictEqual(e.intensity, 0)
})

check('core 指向包含最强信号的子句', () => {
  const e = detectEmotion('今天加班到很晚，真的太累了')
  assert(e.core.includes('累'), `core=${e.core}`)
})

console.log(`\n结果：${passed} 通过，${failed} 失败`)
process.exit(failed ? 1 : 0)
