# BarChart

`BarChart` 是 AniChart v4 的核心可视化组件。它继承自 Pixi.js 的 `Container`，将多帧排名数据渲染成动画条形图。

## 构造函数

```ts
import type { RankedData } from 'anichart-v4/Data'
import { BarChart } from 'anichart-v4'
import { Config } from 'anichart-v4/Config'

const chart = new BarChart(rankedFrames, new Config())
```

- `rankedFrames: RankedData[][]`：逐帧排序的数据列表，通常由 `DataProcessor.processCSV` 生成。
- `config: Config`：控制尺寸、动画、标签等细节的配置对象。

创建实例后，可将其添加到任何 Pixi 容器：

```ts
app.stage.addChild(chart)
```

## 方法

### `update(frameIndex: number): void`

根据帧索引更新图表状态。常见的用法是在渲染循环中递增索引：

```ts
let frame = 0
function loop() {
  chart.update(frame % rankedFrames.length)
  frame += 1
  requestAnimationFrame(loop)
}
loop()
```

若仅需展示静态帧，可调用一次 `update` 并跳过动画循环。

## 交互与组合

- `BarChart` 自身不包含播放控制，可与自定义按钮、时间轴等 UI 组合。
- 你可以在外层容器中添加 Pixi 文本、纹理或滤镜，`BarChart` 只负责条目部分的渲染。

更多细节（如颜色、图片、标签格式）由 `Config` 决定，详见 [Config API](/reference/config)。数据来源相关内容请参阅 [DataProcessor](/reference/data-processor)。
