# 项目结构

AniChart v4 基于 Vite 与 TypeScript 构建，按照功能模块进行分层。了解目录布局有助于快速定位代码与资源。

## 根目录

- `package.json`：定义依赖与脚本。
- `pnpm-workspace.yaml`：配置工作空间，保证子包共享设置。
- `tsconfig.json`：集中管理 TypeScript 编译选项。
- `eslint.config.js`：统一的 ESLint 规则，确保代码风格一致。

## 核心源码

- `src/`：主要功能模块，包括渲染逻辑、图表组合组件以及共享工具。
- `playground/`：实验性代码或原型，保持与生产模块隔离。

## 静态资源

- `public/` 与 `index.html`：静态资产与启动页面，其中 `public/` 下的资源会原样复制到产物中。
- `dist/`：执行 `pnpm build` 后生成的生产构建输出。

## 配置与脚本

- `pnpm dev|build|preview`：开发、构建与预览相关脚本。
- `pnpm test`：运行 Vitest，未来可拓展成覆盖率或端到端测试。

## 扩展建议

- 将新的实验或演示放入 `playground/`，保持生产代码干净。
- 引入环境变量时使用 `VITE_` 前缀，并在文档中说明用途。
- 对外部数据先行清洗并定义类型，确保渲染流程可预测。

进一步的命令细节，可在[命令行工具](/reference/commands)中查阅。
