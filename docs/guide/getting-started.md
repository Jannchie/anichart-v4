# 快速上手

本文面向希望将 AniChart v4 集成到网页或可视化项目的使用者，演示从安装到渲染首个动画排行榜的关键步骤。

## 安装

1. 确认本地已安装 [Node.js](https://nodejs.org/) 16+ 与构建工具（例如 Vite、Webpack）。
2. 安装 AniChart v4 及其依赖：

```bash
pnpm add anichart-v4 pixi.js d3 dayjs
```

如果尚未发布到 npm，可直接引用 Git 仓库：

```bash
pnpm add git+https://github.com/jannchie/anichart-v4.git
```

## 引入到项目

AniChart v4 基于 Pixi.js 渲染，需要在浏览器环境下运行。以下示例展示如何在 Vite 项目中加载 CSV 数据并渲染动画条形图。

```ts
import { BarChart } from 'anichart-v4'
import { Config } from 'anichart-v4/Config'
import { DataProcessor } from 'anichart-v4/DataProcessor'
import { Application } from 'pixi.js'

const config = new Config({
  canvasWidth: 1280,
  canvasHeight: 720,
  topN: 12,
})

async function bootstrap() {
  const app = new Application()
  await app.init({
    width: config.canvasWidth,
    height: config.canvasHeight,
    backgroundColor: config.backgroundColor,
  })

  const rankedFrames = await DataProcessor.processCSV('/data/top-anime.csv', config)
  const chart = new BarChart(rankedFrames, config)

  app.stage.addChild(chart)
  document.body.append(app.canvas)

  let frame = 0
  const tick = () => {
    chart.update(frame % rankedFrames.length)
    frame += 1
    requestAnimationFrame(tick)
  }
  tick()
}

await bootstrap()
```

> 提示：示例中假设 `/data/top-anime.csv` 能通过服务器输出，且结构符合 [数据准备](/guide/data-preparation) 的要求。

## 渲染逻辑概览

- `DataProcessor.processCSV` 读取原始数据并返回逐帧排序结果。
- `BarChart` 将排序帧渲染为 Pixi 容器，可被添加到现有舞台。
- `chart.update(frameIndex)` 根据帧号更新条目，通常配合 `requestAnimationFrame` 循环。

## 常见问题

- **如何加载自定义字体或图片？** 使用 `Config` 提供的钩子函数，在创建图表前写入 `colorMap`、`textureMap` 等，详见[样式定制](/guide/customization)。
- **能否只渲染静态帧？** 只需调用一次 `chart.update(someIndex)` 并停止动画循环。
- **支持其他数据格式吗？** 可以通过自定义数据处理逻辑，将结果转换为 `RankedData[][]` 后直接传入 `BarChart`。

## 下一步

- 阅读[数据准备](/guide/data-preparation)了解 CSV 字段要求。
- 探索[样式定制](/guide/customization)学会定制颜色、标签与过渡动画。
