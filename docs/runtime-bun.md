# 托管 Bun 运行时

Qenex Desktop / VS Code / JetBrains **不把 Bun 打进安装包**。首次启动把钉死版本装到 `~/.qenex/runtime/bun`，重置 App 时保留该目录。

开发态 `bun run dev`（Web）仍用开发者本机 Bun。

## 版本钉

[`runtime/bun-version`](../runtime/bun-version) 一行 semver。CI `setup-bun` 与三端下载共用这一文件（宿主源码里有同值常量，runtime-guard 会核对）。

覆盖：环境变量 `QENEX_BUN_VERSION`。强制指定二进制：`QENEX_BUN_BIN`。

## 布局

```
~/.qenex/runtime/bun/
  .version          # 已安装的 pin
  bin/bun           # Windows: bun.exe
```

## 解析顺序

1. `QENEX_BUN_BIN`（存在才用）
2. 托管 runtime，且 `.version` 与 pin 一致
3. 从 GitHub 下载 pin zip 到托管目录
4. 离线兜底：`PATH` / `~/.bun/bin`（不把系统 Bun 复制进 runtime）

下载失败必须给出 pin 版本、目标路径、以及可设 `QENEX_BUN_BIN`；禁止静默卡死。

## 下载

官方 zip，**不用** `curl | bun.sh`：

`https://github.com/oven-sh/bun/releases/download/bun-v{version}/bun-{os}-{arch}.zip`

| 平台 | asset |
|------|--------|
| macOS arm64 | `bun-darwin-aarch64` |
| macOS x64 | `bun-darwin-x64` |
| Linux x64 | `bun-linux-x64` |
| Linux arm64 | `bun-linux-aarch64` |
| Windows x64 | `bun-windows-x64` |

zip 内是 `{asset}/bun`（或 `bun.exe`）。解压后只留下 `bin/` 下的可执行文件。

## PATH

宿主 spawn Bridge 时，把 `~/.qenex/runtime/bun/bin` **放在 PATH 最前**，以便 `bun add` 与 Agent shim 用同一份。

Bridge 安装 Agent 时优先 `process.execPath`（当前解释器），再 which。

## uv

`~/.qenex/runtime/uv` 目录会创建，但本阶段不自动安装 uv。uvx 发行的 Agent 仍需本机 `uv`。
