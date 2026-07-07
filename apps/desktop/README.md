# Tauri Desktop（待实现）

桌面壳，通过 Tauri sidecar 打包 `crates/bridge` 二进制。

计划结构：

```
apps/desktop/
├── src/              # React 入口 + tauri-host
├── src-tauri/        # Tauri 配置与 sidecar
└── package.json
```
