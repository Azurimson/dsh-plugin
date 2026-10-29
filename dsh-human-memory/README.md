# dsh-human-memory

> 版本 **0.1.2** ｜ 变化记录与测试方法见 [更新文档.md](./更新文档.md)

给 DeepSeek Harness（DSH）赋予一套受认知科学启发的「人类式记忆」本地插件。

- **遗忘曲线**（时间衰减）：记忆随时间先快后慢地淡忘。
- **内容重要性**（六维评分）：有意义、有结构、具体、自我相关、独特、有情绪、停留久的内容记得更牢。
- **间隔重复 + 间隔效应**：同一事件间隔越久再次被提起，加深越多。
- **巩固**（睡眠巩固的类比）：把高价值情节记忆合并提炼成语义记忆。
- **主动复习**：找出临近遗忘的记忆。
- **每轮自动自查**：每轮对话结束后自动判断哪些信息值得记住并写入。
- **行为记忆 + 时间线**：每轮记录「做了什么」，可按天 / 会话按顺序检索。
- **工作记忆层**：精确记录「改了哪个文件、跑了哪些命令」，低权重、短寿命。
- **事件日期**：每条记忆记录「事件发生时间」，可回答「这件事是什么时候发生的」。
- **设置区卡片**：打开记忆文件夹按钮 + 按权重排序的记忆列表。

记忆**全部存在本地**（目录式记忆库，每条记忆独立成文件），不联网、不依赖任何云端数据库。

> 本项目是抛砖引玉之作，架构与参数都还粗糙，期待大佬们来迭代。已开源，欢迎提交 bug 反馈与改进建议。

## 目录结构

```
dsh-human-memory/
├── package.json          # dsh.bundle + dsh.client manifest
├── cordis.patch.yml      # 插件挂载行
├── dsh.plugin.json       # 市场注册清单
├── settings.json         # 所有权重与参数（中文注释，可直接改）
├── LICENSE
├── README.md
├── src/
│   ├── index.js          # 插件入口：工具 / 命令 / 事件 / 自动自查
│   ├── memory.js         # 记忆引擎核心（评分 / 衰减 / 间隔 / 巩固 / 日期 / 工作记忆）
│   ├── store.js          # 目录式记忆库（memories/<layer>/ + index.json）
│   ├── settings.js       # 配置加载与默认值
│   └── gui.js            # 设置卡片的数据接口（本地 127.0.0.1）
├── client/
│   └── client.js         # 设置区卡片（lazy-CJS，注册到插件详情页）
├── test/
│   ├── self-test.mjs     # 核心逻辑自测
│   ├── library-test.mjs  # 目录式记忆库与迁移自测
│   ├── consolidate-test.mjs # 巩固实测
│   ├── gui-test.mjs      # 记忆接口服务实测
│   └── plugin-smoke.mjs  # 入口冒烟（mock DSH ctx）
├── 实现思路.md
├── 备选方案-人类记忆缺陷.md
├── 测试文档.md
├── 更新文档.md
├── 迭代方向-用户画像记忆.md
└── 迭代方向-会话短期记忆.md
```

运行时的记忆库结构（`~/.dsh/human-memory/`）：

```
human-memory/
├── index.json                  # 人类可读索引（含日期、重要性、内容预览）
├── state.json                  # 调度状态（上次巩固时间等）
├── trash/                      # 删除缓冲区：删除的记忆先移到这里，下次巩固时真正删除
│   └── <id>.json
└── memories/
    ├── working/<id>.json       # 工作记忆：精确操作，低权重、短寿命
    ├── episodic/<id>.json      # 情节记忆：这一轮做了什么
    ├── semantic/<id>.json      # 语义记忆：巩固后的事实/偏好
    └── core/<id>.json          # 核心记忆：极重要
```

## 安装

本插件是**纯 ESM JavaScript，无需构建步骤**，直接安装即可加载：

```sh
dsh plugin --profile <你的 profile> add ./dsh-human-memory
```

重启 Web Harness 后生效。卸载：

```sh
dsh plugin --profile <你的 profile> remove dsh-human-memory
```

> `@deepseek-ai/cordis`、`@deepseek-ai/dsh-tools` 作为 peerDependencies 由 DSH 宿主提供，插件无需自行安装。

## 提供的工具（模型可调用）

| 工具 | 作用 |
|------|------|
| `memory_write` | 写入 / 再次提起一条记忆（间隔越久加深越多） |
| `memory_recall` | 按「相关度 + 强度 + 重要性」回忆事实记忆 |
| `memory_timeline` | 按天 / 会话按时间正序检索「每一轮做了什么」 |
| `memory_forget` | 真正删除一条记忆 |
| `memory_consolidate` | 情节记忆 → 语义记忆 |
| `memory_review` | 列出临近遗忘的记忆 |

## 斜杠命令（用户手动触发）

- `/memory-review` — 列出临近遗忘的记忆
- `/memory-consolidate` — 手动触发一次巩固
- `/memory-list` — 列出所有本地记忆

## 设置区卡片

- 位置：**设置页左侧「记忆」分区**（`settings.section` 槽，参考 `dsh-notify-say` 的做法）。
- 内容：顶部「打开记忆文件夹」按钮 + 刷新；下方按权重（`importance`）倒序的记忆列表（不显示权重数字；有来源会话时显示短 id；右侧有删除按钮）。
- 删除：点击**不弹确认**、立即从列表移除；记录被**移动**到记忆库的 `trash/` 文件夹（可备份/恢复），下次巩固时真正删除。
- 数据来源：DSH 内置 Web 服务器上的路由 `/api/dsh-human-memory/memories`、`/api/dsh-human-memory/delete`、`/api/dsh-human-memory/trash`、`/api/dsh-human-memory/restore`、`/api/dsh-human-memory/open-folder`（不占用独立端口）。
- 说明：卡片在浏览器半，读不到宿主内存，所以通过宿主路由取数据；它不是网页 GUI，也没有独立页面。

## 配置

编辑 `settings.json`（支持 `//` 中文注释），保存后重启 DSH 生效。关键参数：

- `autoCapture.enabled` / `minChars` / `maxPerTurn` / `includeAssistant` — 每轮自动自查开关与阈值
- `autoCapture.turnLog` — 是否记录「行为记忆」（供时间线检索）
- `storage.trashDir` — 删除缓冲区文件夹名（默认 `trash`，位于记忆库根目录）
- `workingMemory.enabled` / `capacity` / `minRetentionMs` / `importance` — 工作记忆（`capacity: 0` 不设上限；`minRetentionMs` 默认 24h，只在 24h 巩固节点回收）
- `gui.enabled` — 是否注册设置卡片的数据路由
- `forgetting.tauMs` / `c` — 遗忘曲线速度与形状
- `importance.*` — 六维重要性权重（含「记忆时长」`dwell`）
- `retrieval.*` — 检索排序权重
- `spacing.kappa` / `reinforce` — 间隔效应强度
- `consolidation.*` — 巩固阈值、归档策略与 `intervalMs`（默认 24h，不再每轮触发）
- `review.mode` — 主动复习模式（`manual` / `auto` / `off`）

完整含义见文件内注释，设计推导见 [实现思路.md](./实现思路.md)。

## 如何验证插件是否正常工作

### 1. 核心逻辑与记忆库自测（不需要 DSH，最快）

```sh
pnpm test        # self-test + library-test + consolidate-test + gui-test
# 或分别跑：
node test/self-test.mjs
node test/library-test.mjs
node test/consolidate-test.mjs
node test/gui-test.mjs
```

`self-test` 27 项、`library-test` 15 项、`consolidate-test` 10 项、`gui-test` 17 项。

### 2. 确认插件被 DSH 加载

重启 DSH 后，若之前的激活警告消失，即说明已加载。也可在对话里说「列出你当前可用的 memory 相关工具」，应能看到 `memory_write` / `memory_recall` / `memory_timeline` / `memory_forget` / `memory_consolidate` / `memory_review`。

### 3. 端到端功能测试

| 操作 | 预期 |
|------|------|
| 说「记住：这个项目用 Python 和 Vue 开发」 | 调用 `memory_write`，返回「已记住 …」 |
| 说「我的项目用什么语言？」 | 调用 `memory_recall` 并答出 Python / Vue |
| 说「今天我们在这个会话里都做了什么？」 | 调用 `memory_timeline` 按顺序列出每轮 |
| 输入 `/memory-list` | 列出刚写入的记忆 |
| 输入 `/memory-review` | 列出临近遗忘的记忆 |
| 打开 设置 → 插件 → dsh-human-memory | 看到卡片（打开文件夹按钮 + 按权重列表） |
| 写入几条相似记忆后输入 `/memory-consolidate` | 生成语义记忆，原情节记忆归档 |

### 4. 检查本地数据

记忆库默认在 `~/.dsh/human-memory/`（Windows：`C:\Users\<你>\.dsh\human-memory\`）。记录形如：

```json
{ "id": "mem-…", "content": "…", "layer": "episodic", "kind": "fact", "occurredAt": 1793248628335, "importance": 0.58 }
```

工作记忆记录形如：

```json
{ "id": "work-…", "content": "写文件：src/index.js", "layer": "working", "kind": "tool", "importance": 0.05 }
```

### 5. 插件入口自测（可选，需要 mock 或 DSH 宿主提供 `@deepseek-ai/dsh-tools`）

```sh
node test/plugin-smoke.mjs
```

用 mock ctx 跑一遍 `apply()`，验证 6 个工具、3 个命令、自动自查、行为/工作记忆（含去重）与目录式落盘（20 项检查）。

完整验收清单见 [测试文档.md](./测试文档.md)。

## 仓库结构

已按可发布结构组织：`package.json` 的 `dsh.bundle` / `dsh.client` / `exports`、`cordis.patch.yml`、`dsh.plugin.json`、`LICENSE`、`.github/workflows/ci.yml`。推送到 GitHub 时加 `dsh-plugin` topic 即可被市场按约定识别。

## 当前限制（欢迎贡献）

- **设置区卡片**注册在 `settings.section`（设置页左侧「记忆」分区），数据走 DSH 内置 Web 服务器的 `/api/dsh-human-memory` 路由。
- **工作记忆**默认不设条数上限，靠 24 小时 TTL 在巩固节点回收；参与召回、复习与巩固，但权重刻意很低（0.05）；同一会话同一操作会去重。
- **巩固与工作记忆回收**每 24 小时执行一次（`consolidation.intervalMs`），不是每轮。
- **工作记忆**目前只记录工具调用（文件/命令），尚未记录更细粒度的参数 diff。
- **行为记忆**是「用户 + 助手 + 工具名」的轻量摘要。
- **用户画像记忆**（口癖、句式、逻辑习惯）为未来方向，见 [迭代方向-用户画像记忆.md](./迭代方向-用户画像记忆.md)。
- **会话短期记忆**（减少 agent 反复回看上下文）为未来方向，见 [迭代方向-会话短期记忆.md](./迭代方向-会话短期记忆.md)。
- **语义相关度**用字符 n-gram，未接 embedding。
- **巩固**是规则式拼接，未接 LLM 摘要。
- **自动复习**的发起者（DSH 主动 vs 用户命令）尚未定案。
- **多实例并发**写同一记忆库无文件锁，后写覆盖（单实例内无碍）。
