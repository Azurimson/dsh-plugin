> English | [中文](./README.md)

# dsh-plugin

A collection of DeepSeek Harness (DSH) plugins. Each plugin lives in its own subdirectory and is installed independently.

## Plugins

| Plugin | Summary | Version |
|--------|---------|---------|
| [dsh-human-memory](./dsh-human-memory) | Human-like memory for DSH, inspired by cognitive science: forgetting curve, spaced repetition, consolidation, proactive review, per-turn auto capture, emotion detection, SQLite indexing, and reconstruction with persona parameters, plus a settings-panel GUI. All data stays in a local directory-based store. Documentation is bilingual. | [v0.1.4](https://github.com/Azurimson/dsh-plugin/releases/tag/v0.1.4) |

## Installing a plugin

```sh
git clone https://github.com/<your-username>/dsh-plugin.git
cd dsh-plugin

# dsh-human-memory as an example
dsh plugin --profile <your profile> add ./dsh-human-memory
```

Restart DSH for it to take effect. To uninstall:

```sh
dsh plugin --profile <your profile> remove dsh-human-memory
```

See each plugin's own `README.md` for details, configuration, and verification steps.

## Directory conventions

```
dsh-plugin/
├── <plugin-name>/
│   ├── package.json      # contains the dsh.bundle manifest
│   ├── cordis.patch.yml  # plugin mount line
│   ├── src/              # plain ESM JavaScript, no build step
│   ├── test/             # self-tests runnable with plain node
│   ├── 更新文档.md        # changelog and how to test each change
│   └── README.md
└── .gitignore
```

## License

Each plugin is MIT-licensed unless stated otherwise in its own directory.
