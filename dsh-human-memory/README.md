# dsh-human-memory

给 DeepSeek Harness（DSH）赋予一套受认知科学启发的「人类式记忆」本地插件。

- **遗忘曲线**（时间衰减）：记忆随时间先快后慢地淡忘。
- **内容重要性**（六维评分）：有意义、有结构、具体、自我相关、独特、有情绪、停留久的内容记得更牢。
- **间隔重复 + 间隔效应**：同一事件间隔越久再次被提起，加深越多。
- **巩固**（睡眠巩固的类比）：把高价值情节记忆合并提炼成语义记忆。
- **主动复习**：找出临近遗忘的记忆。

记忆**全部存在本地**（单个 JSON 文件），不联网、不依赖任何云端数据库。

> 本项目是抛砖引玉之作，架构与参数都还粗糙，期待大佬们来迭代。已开源，欢迎提交 bug 反馈与改进建议。

## 目录结构

```
dsh-human-memory/
├── package.json          # dsh.bundle manifest + 依赖
├── cordis.patch.yml      # 插件挂载行
├── settings.json         # 所有权重与参数（中文注释，可直接改）
├── src/
│   ├── index.js          # 插件入口：注册工具 / 命令 / 事件
│   ├── memory.js         # 记忆引擎核心（评分公式 / 衰减 / 间隔 / 巩固）
│   ├── store.js          # 本地 JSON 文件存储
│   └── settings.js       # 配置加载与默认值
├── test/
│   ├── self-test.mjs     # 核心逻辑自测（11 项）
│   └── plugin-smoke.mjs  # 插件入口注册自测（8 项）
├── 实现思路.md            # 设计文档
├── 备选方案-人类记忆缺陷.md # 人类记忆缺陷的备选实现方案
└── 测试文档.md            # 完整验收清单
```

## 安装

本插件是**纯 ESM JavaScript，无需构建步骤**，直接安装即可加载。

先把仓库克隆下来（本插件位于其子目录）：

```sh
git clone https://github.com/<你的用户名>/dsh-plugin.git
cd dsh-plugin
```

然后把这个子目录挂进 DSH：

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
| `memory_recall` | 按「相关度 + 强度 + 重要性」回忆 |
| `memory_forget` | 真正删除一条记忆 |
| `memory_consolidate` | 情节记忆 → 语义记忆 |
| `memory_review` | 列出临近遗忘的记忆 |

## 斜杠命令（用户手动触发）

- `/memory-review` — 列出临近遗忘的记忆
- `/memory-consolidate` — 手动触发一次巩固
- `/memory-list` — 列出所有本地记忆

## 配置

编辑 `settings.json`（支持 `//` 中文注释），保存后重启 DSH 生效。关键参数：

- `forgetting.tauMs` / `c` — 遗忘曲线速度与形状
- `importance.*` — 六维重要性权重（含「记忆时长」`dwell`）
- `retrieval.*` — 检索排序权重
- `spacing.kappa` / `reinforce` — 间隔效应强度
- `consolidation.*` — 巩固阈值与归档策略
- `review.mode` — 主动复习模式（`manual` / `auto` / `off`）
- `workingMemory.capacity` — 上下文容量

完整含义见文件内注释，设计推导见 [实现思路.md](./实现思路.md)。

## 如何验证插件是否正常工作

### 1. 核心逻辑自测（不需要 DSH，最快）

```sh
node test/self-test.mjs
```

覆盖 11 项：配置加载、六维重要性、时间衰减、间隔效应、检索排序、巩固、复习。应输出「11 通过，0 失败」。

### 2. 确认插件被 DSH 加载

重启 DSH 后，若之前的 `1 entry did not activate human-memory` 警告消失，即说明已加载。也可在对话里说「列出你当前可用的 memory 相关工具」，应能看到 `memory_write` / `memory_recall` / `memory_forget` / `memory_consolidate` / `memory_review`。

### 3. 端到端功能测试（在 GUI 里操作）

| 操作 | 预期 |
|------|------|
| 说「记住：这个项目用 Python 和 Vue 开发」 | 调用 `memory_write`，返回「已记住 …」 |
| 说「我的项目用什么语言？」 | 调用 `memory_recall` 并答出 Python / Vue |
| 输入 `/memory-list` | 列出刚写入的记忆 |
| 输入 `/memory-review` | 列出临近遗忘的记忆 |
| 写入几条相似记忆后输入 `/memory-consolidate` | 生成语义记忆，原情节记忆归档 |

### 4. 检查本地数据

记忆文件默认在 `~/.dsh/human-memory/memories.json`（Windows：`C:\Users\<你>\.dsh\human-memory\memories.json`）。第一次成功 `memory_write` 后该文件会出现，内容形如：

```json
{ "version": 1, "memories": [ { "id": "mem-…", "content": "…", "layer": "episodic", "importance": 0.58 } ] }
```

### 5. 插件入口自测（可选，需要 mock 或 DSH 宿主提供 `@deepseek-ai/dsh-tools`）

```sh
node test/plugin-smoke.mjs
```

用 mock ctx 跑一遍 `apply()`，验证 5 个工具、3 个命令的注册与落盘（8 项检查）。

完整验收清单（含手动用例、边界、验收标准）见 [测试文档.md](./测试文档.md)。

## 当前限制（欢迎贡献）

- 语义相关度用的是**字符 n-gram 相似度**，尚未接入 embedding（向量）模型，长文本语义匹配不够准。
- 巩固的合并是**规则式**（拼连接 + 去重），尚未接入 LLM 做摘要提炼。
- 自动复习的「由 DSH 主动 / 由用户命令触发」取舍尚未定案，见 [备选方案](./备选方案-人类记忆缺陷.md)。
