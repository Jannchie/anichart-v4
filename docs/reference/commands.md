# 命令行工具

本页汇总 `package.json` 中预设的脚本以及常见运行方式，方便快速查询。

## 开发阶段

- `pnpm dev`：启动 Vite 本地开发服务器，提供热更新能力。

## 构建与发布

- `pnpm build`：先运行 TypeScript 类型检查，再执行生产构建，输出至 `dist/`。
- `pnpm preview`：以本地服务器预览生产构建结果，适合部署前演练。

## 测试

- `pnpm test`：调用 Vitest 执行单元测试。当前项目尚未配置具体用例，可在 `src/` 内创建 `*.test.ts` 文件逐步完善。

## 文档

- `pnpm docs:dev`：启动 VitePress 文档站点的开发服务器。
- `pnpm docs:build`：生成静态文档，默认输出至 `docs/.vitepress/dist`。
- `pnpm docs:preview`：本地预览生成的文档站点。

在执行脚本过程中若出现依赖或权限问题，可先运行 `pnpm install` 或检查本地 Node.js 版本。
