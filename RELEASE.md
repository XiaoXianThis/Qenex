# Release 流程

打 tag 或手动触发 GitHub Actions，构建产物并上传到 GitHub Release。

## 产物

| 产物 | 文件名 | 说明 |
|------|--------|------|
| Server | `qenex-server-<ver>-linux-x64.zip` | Bun Bridge + Web；`./start.sh` → `http://127.0.0.1:3000` |
| VS Code | `qenex-vscode-<ver>.vsix` | 扩展；本机 Bun 起 Bridge |
| JetBrains | `qenex-jetbrains-<ver>.zip` | 插件；本机 Bun 起 Bridge |
| Desktop | `qenex-desktop-<ver>-<platform>-…` | Tauri 安装包（win / darwin-arm64 / linux） |

运行时均需本机安装 [Bun](https://bun.sh)（嵌入 Bun 另立项）。

## 维护者步骤

1. 更新 [`CHANGELOG.md`](./CHANGELOG.md)
2. 确认 `fusion`（或发布分支）已推送、CI 绿
3. 打 tag 并推送：

```bash
git checkout fusion
git pull
git tag v0.3.1
git push origin v0.3.1
```

4. 打开 Actions → **Release** workflow，等待矩阵完成
5. 在 GitHub Releases 检查附件与说明

### 手动触发（不打 tag）

Actions → Release → Run workflow：

- `version`：如 `0.3.1`
- `publish`：勾选则创建草稿 Release**（`v0.3.1`）；不勾选只上传 Artifacts

## 本地打包

```bash
# 全量（当前 OS Desktop + 全端）
bun run ci:release -- --platform darwin-arm64 --version 0.3.1

# 仅 server + IDE（适合 Ubuntu / 本机预检）
bun run ci:release -- --platform linux-x64 --version 0.3.1 --products server,vscode,jetbrains

# 仅 Desktop
bun run ci:release -- --platform darwin-arm64 --version 0.3.1 --products desktop
```

产物目录：`dist-artifacts/`（已 gitignore）。

版本会写入：`apps/vscode/package.json`、`apps/jetbrains/gradle.properties`、`apps/desktop`（package / tauri / Cargo）、`apps/bridge/package.json`。本地试跑后勿把未打算发布的版本改动误提交，或再改回。

## Workflow 结构

- **shared**（ubuntu）：server + vscode + jetbrains  
- **desktop**（win / mac / linux）：各平台 Desktop 安装包  
- **release**：合并 artifact → `softprops/action-gh-release`

## 常见问题

- Desktop macOS 产物默认未公证；本机可能需「仍要打开」
- JetBrains / VS Code 需本机 Bun；缺依赖时宿主会尝试 `bun install`（见各端 README）
- `bun install --frozen-lockfile` 失败：先本地 `bun install` 并提交 lockfile
