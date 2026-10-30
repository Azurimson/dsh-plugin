// test/client-test.mjs — 设置卡片（客户端半）渲染冒烟
// 用 mock React / window / document / fetch 执行 client.js，验证注册与顶部按钮。
// 运行：node test/client-test.mjs
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const code = readFileSync(join(__dirname, '..', 'client', 'client.js'), 'utf8')

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

const React = {
  createElement(type, props, ...children) {
    return { type, props: props || {}, children: children.flat() }
  },
  useState(initial) {
    return [typeof initial === 'function' ? initial() : initial, function () {}]
  },
  useEffect() {},
  useCallback(fn) {
    return fn
  },
}

let registered = null
const slots = {
  inject(_name, cb) {
    cb()
  },
  register(meta, comp) {
    registered = { meta, comp }
    return function () {}
  },
}

let loaderModule = null
globalThis.window = {
  __ModuleLoader__: {
    load(def) {
      loaderModule = def.factory(function (id) {
        if (id === 'react') return React
        return {}
      })
    },
  },
}
globalThis.document = { baseURI: 'http://127.0.0.1:52716/' }
globalThis.fetch = function () {
  return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ memories: [] }) } })
}

new Function(code)()

console.log('dsh-human-memory 设置卡片渲染冒烟\n')

check('客户端模块导出 apply / inject / name', () => {
  assert.strictEqual(typeof loaderModule.apply, 'function')
  assert.deepStrictEqual(loaderModule.inject, ['slots'])
  assert.strictEqual(loaderModule.name, 'dsh-human-memory')
})

loaderModule.apply({ get: function (n, d) { return n === 'slots' ? slots : d } })

check('注册 settings.section 且 label=记忆', () => {
  assert(registered)
  assert.strictEqual(registered.meta.name, 'settings.section')
  assert.strictEqual(registered.meta.label, '记忆')
})

const tree = registered.comp()
const topBar = tree.children[0]

check('顶部渲染 6 个文件夹按钮', () => {
  const tabs = topBar.children[0]
  assert.strictEqual(tabs.children.length, 6)
  const labels = tabs.children.map((b) => b.children.join(''))
  assert(labels.some((s) => s.indexOf('工作') >= 0), labels.join(','))
  assert(labels.some((s) => s.indexOf('情节') >= 0), labels.join(','))
  assert(labels.some((s) => s.indexOf('语义') >= 0), labels.join(','))
  assert(labels.some((s) => s.indexOf('核心') >= 0), labels.join(','))
  assert(labels.some((s) => s.indexOf('回收站') >= 0), labels.join(','))
})

check('右上角有「权重↓」「时间↓」按钮', () => {
  const actions = topBar.children[1]
  const labels = actions.children.map((b) => b.children.join(''))
  assert(labels.indexOf('权重↓') >= 0, labels.join(','))
  assert(labels.indexOf('时间↓') >= 0, labels.join(','))
})

console.log(`\n结果：${passed} 通过，${failed} 失败`)
process.exit(failed ? 1 : 0)
