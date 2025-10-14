# 快速开始

本文帮助你从零开始运行 AniChart v4，并理解开发过程中常用的工作流。

## 环境准备

1. 安装 [Node.js](https://nodejs.org/)（建议使用 LTS 版本）和 [pnpm](https://pnpm.io/installation)。
2. 克隆仓库：
   ```bash
   git clone https://github.com/jannchie/anichart-v4.git
   cd anichart-v4
   ```
3. 安装依赖：
   ```bash
   pnpm install
   ```

## 常用开发命令

- 开发服务器：
  ```bash
  pnpm dev
  ```
  启动后可在浏览器访问 `http://localhost:5173`，实时查看修改效果。

- 生产构建：
  ```bash
  pnpm build
  ```
  会执行 TypeScript 类型检查并生成 `/dist` 目录。

- 本地预览：
  ```bash
  pnpm preview
  ```
  用于检查最终构建结果。

## 推荐工作流

1. 通过 `pnpm dev` 启动开发环境。
2. 在 `src/` 中进行功能或视觉实现，并使用 ESLint 提示保持代码质量。
3. 提交到仓库前执行 `pnpm build` 确保构建通过。

## 下一步

继续阅读[项目结构](/guide/project-structure)，了解模块划分和主要约定，也可以直接查阅[命令行工具](/reference/commands)快速回顾脚本用法。
