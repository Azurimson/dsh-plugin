# 发布流程

每次发布都按这个顺序走，不要跳步。流程对齐 v0.1.1 / v0.1.2 两次实际发布。

## 0. 版本号规则

- 每次更新只递增最后一位（`+0.0.1`）；**只在确定稳定后才升版，不稳定不升**。
- 版本号要出现在三处，且必须一致：
  - `dsh-human-memory/package.json` → `version`
  - `dsh-human-memory/dsh.plugin.json` → `version`
  - `dsh-human-memory/README.md` 顶部版本行

## 1. 同步到仓库子目录

把工作目录 `D:\dsh-walk-in-world\dsh-human-memory` 的改动同步到 `dsh-plugin/dsh-human-memory`，**排除 `deepseek-conversation.txt`**（该文件不上传）。

## 2. 跑测试，全绿才继续

```sh
node test/self-test.mjs
node test/library-test.mjs
node test/consolidate-test.mjs
node test/gui-test.mjs
```

## 3. 提交 + 打标签

```sh
git add -A
git commit -m "feat: vX.Y.Z —— <一句话概括>"
git tag -a vX.Y.Z -m "vX.Y.Z — <一句话概括>"
```

## 4. 推送分支与标签

本机 `github.com` 直连不稳定，走本地 CONNECT 代理（`_tmp/connect-proxy.cjs`，端口 18765），并强制 OpenSSL TLS 后端：

```sh
git -c http.proxy=http://127.0.0.1:18765 -c http.sslBackend=openssl push <带 token 的 URL> main:main refs/tags/vX.Y.Z
```

## 5. 重新钉住市场索引（最容易漏的一步）

`dsh-human-memory/dsh-market.json` 里 `versions[0].source.commit` 必须等于**本次 tag 指向的 commit**：

```sh
git rev-parse vX.Y.Z^{commit}
```

改完用 DSH 自带的 `@deepseek-ai/dsh-plugin-market-index` 的 `parseMarketIndex()` 校验，再单独提交一次：

```sh
git commit -m "chore: 重新钉住市场索引到 vX.Y.Z"
```

> 漏做这一步，插件市场装到的仍是旧提交。

## 6. 发 GitHub Release

- 标题：`vX.Y.Z — <一句话概括>`
- 正文：从 `dsh-human-memory/更新文档.md` 对应版本整理，附测试结果与安装命令。
- 标签选已推送的 `vX.Y.Z`。

## 7. 收尾

- 根 `README.md` 插件表的版本链接指到新 Release。
- 同步本地 `origin/main` 跟踪引用（`git update-ref`），确认 `git status` 干净。
- 确认远端 `main` 的 commit 与本地一致。
