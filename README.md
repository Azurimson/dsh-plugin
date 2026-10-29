# dsh-plugin

DeepSeek Harness（DSH）插件合集。每个插件一个子目录，互相独立、按需安装。

## 插件列表

| 插件 | 简介 | 版本 |
|------|------|------|
| [dsh-human-memory](./dsh-human-memory) | 给 DSH 一套受认知科学启发的「人类式记忆」：遗忘曲线、间隔重复、巩固、主动复习、每轮自动自查。数据全部存本地目录式记忆库。 | [v0.1.1](https://github.com/Azurimson/dsh-plugin/releases/tag/v0.1.1) |

## 安装某个插件

```sh
git clone https://github.com/<你的用户名>/dsh-plugin.git
cd dsh-plugin

# 以 dsh-human-memory 为例
dsh plugin --profile <你的 profile> add ./dsh-human-memory
```

重启 DSH 后生效。卸载：

```sh
dsh plugin --profile <你的 profile> remove dsh-human-memory
```

每个插件的详细说明、配置项与验证步骤见各自目录下的 `README.md`。

## 目录约定

```
dsh-plugin/
├── <plugin-name>/
│   ├── package.json      # 含 dsh.bundle manifest
│   ├── cordis.patch.yml  # 插件挂载行
│   ├── src/              # 纯 ESM JavaScript，免构建
│   ├── test/             # 可直接 node 运行的自测脚本
│   ├── 更新文档.md        # 变更记录与每个变化点的测试方法
│   └── README.md
└── .gitignore
```

## 许可

各插件默认采用 MIT 许可，详见对应目录。
