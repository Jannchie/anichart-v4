# AniChart v4

[![CodeTime Badge](https://img.shields.io/endpoint?style=social&color=222&url=https%3A%2F%2Fapi.codetime.dev%2Fshield%3Fid%3D2%26project%3Danichart-v4%26in=0)](https://codetime.dev)

基于 PIXI.js 的动画数据可视化框架（bar chart race / 折线趋势），并用 Remotion 渲染成视频。

本仓库是 pnpm + Turborepo 管理的 monorepo：

| 包 | 路径 | 说明 |
| --- | --- | --- |
| `@anichart/core` | `packages/core` | 库本体：PIXI.js 动画图表引擎 |
| `playground` | `apps/playground` | 交互式 demo（实时播放/倍速），试玩库的沙盒 |
| `docs` | `apps/docs` | VitePress 文档 |
| `studio` | `apps/studio` | Remotion 视频渲染工程（逐帧渲成 mp4），未来视频导出功能的种子 |
| `web` | `apps/web` | Nuxt SaaS：上传数据、配置图表、在线播放与分享可视化作品 |

## 快速开始

```bash
pnpm install                      # 安装并连接 workspace
pnpm --filter @anichart/core build  # 先构建库（apps 消费其 dist）

pnpm --filter playground dev      # 交互式 demo
pnpm --filter docs dev            # 文档
pnpm --filter web dev             # SaaS（需先配置 apps/web/.env，见 .env.example）
pnpm --filter studio start        # Remotion Studio
```

## 常用命令（根目录，经 Turborepo 编排）

```bash
pnpm build       # 按依赖顺序构建全部包
pnpm test        # 运行测试（@anichart/core 的 vitest）
pnpm typecheck   # 全量类型检查
pnpm lint        # 全量 lint
pnpm dev         # 并行启动各包 dev（core 以 watch 构建供消费）
```

> 内部包消费策略：apps 消费 `@anichart/core` 的**构建产物 dist**（含 `.d.ts`），使库的内部类型严格度与各 app 的 tsconfig 解耦。因此运行 app 的 dev/build/typecheck 前需先 build core —— Turborepo 已通过 `^build` 依赖自动排序。
