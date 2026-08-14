# JetBrains Plugin

JCEF Tool Window 壳，加载 `@qenex/ui`，宿主 spawn **本机 Bun + `apps/bridge`**（M9，与 Desktop 同契约）。

## 前置

- 本机已安装 [Bun](https://bun.sh)（`PATH` / `~/.bun/bin`，或设 `QENEX_BUN_BIN`）
- JDK 21+（Gradle IntelliJ Platform 插件）

## 开发

```bash
bun run build:jetbrains   # 暂存 bridge → webview → compileKotlin
cd apps/jetbrains && ./gradlew runIde
```

`runIde` **优先**使用仓库 `apps/bridge`；发布包使用构建时生成的自包含 Bridge bundle。

可选覆盖：

```bash
export QENEX_BRIDGE_ENTRY=/绝对路径/apps/bridge/src/index.ts
export QENEX_BUN_BIN=$HOME/.bun/bin/bun
```

## 架构

```
Kotlin Host                       Webview (@qenex/ui)
├── spawn: bun bridge/index.js      ├── createJetbrainsHost()
│   env: QENEX_BRIDGE_PORT / CORS  │   ├── getBridgeBaseUrl()
└── bridge-ready { url }           └── fetch → localhost Bridge
```

打包资源：`qenex/bridge/index.js`（自包含 bundle + 清单）；运行时仍用系统 Bun，用户机器无需联网安装依赖。

## 验收

```bash
bun run verify:jetbrains
bun run --filter @qenex/bridge test:m9
```
