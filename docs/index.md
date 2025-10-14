# AniChart v4 文档

AniChart v4 是基于 Pixi.js 的动画排行榜组件，专注于呈现高帧率、平滑过渡的条形图。本手册面向库的使用者，帮助你在最短时间内完成接入与定制。

## 主要能力

- **极速动画**：内建插值与模糊排名逻辑，保障流畅切换。
- **灵活数据源**：支持 CSV、JSON 等多种格式，提供 `DataProcessor` 简化预处理。
- **丰富定制**：通过 `Config` 钩子和映射表控制颜色、字体、标签、退场动画。
- **与 Pixi 协同**：作为 `Container` 直接添加到现有 Pixi 舞台，与其他 2D 元素自由组合。

## 快速导航

- 第一次使用？查看[快速上手](/guide/getting-started)了解集成流程。
- 不确定数据格式？阅读[数据准备](/guide/data-preparation)获取示例与最佳实践。
- 想改造视觉效果？前往[样式定制](/guide/customization)。
- 查阅 API 细节：`BarChart`、`Config`、`DataProcessor` 位于[参考手册](/reference/bar-chart)。

欢迎通过 Issue 或 PR 分享你的需求与想法。
