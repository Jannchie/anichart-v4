# 样式定制

AniChart v4 提供灵活的配置项和钩子函数，帮助你调节条目展示、颜色、标签格式等细节。下面从常见场景出发介绍关键用法。

## 控制展现规模

```ts
import { Config } from 'anichart-v4/Config'

const config = new Config({
  topN: 15,
  swapDurationSec: 0.6,
  totalDurationSec: 30,
  fps: 60,
})
```

- `topN`：屏幕上同时展示的条目数量。
- `swapDurationSec`：条目交换排名时的动画时长。
- `totalDurationSec`：整段动画的目标时长，配合 `fps` 控制帧数。

## 自定义标签与数值

```ts
const config = new Config({
  getValueLabel: data => data.value.toLocaleString(),
  getValueExtra: data => `${(data.value / 1000).toFixed(1)}K`,
  getBarInfo: (data, index, frame) => `#${index + 1} • ${data.raw?.series ?? ''}`,
})
```

- `getValueLabel`：决定条形末端的主要数值文本。
- `getValueExtra`：追加辅助信息（如缩写、百分比）。
- `getBarInfo`：控制条形内部显示的描述文本，可使用 `data.raw` 访问原始字段。

## 设置颜色与图片

```ts
import { colorMap, textureMap } from 'anichart-v4/main'
import { Assets, Texture } from 'pixi.js'

colorMap.set('OnePiece', 0xF7_6F_8E)

const cover = await Assets.load<Texture>('/covers/onepiece.png')
textureMap.set('OnePiece', cover)

const config = new Config({
  colorField: 'id',
  imageField: 'image',
})
```

- `colorMap`：缓存指定字段到颜色值的映射，返回值为十六进制整数。
- `textureMap`：缓存图片纹理，`BarChart` 会自动匹配 `config.imageField` 指向的原始字段。

## 调整坐标轴与布局

```ts
const config = new Config({
  canvasWidth: 1080,
  canvasHeight: 1080,
  title: 'Global Sales Leaderboard',
  xAxisLabel: 'Global Sales',
  valueScaleType: 'from-min', // from-zero | from-min | from-delta
  valueScaleDelta: 100,
  leftLabelPadding: 12,
  barGap: 6,
  barInfoStyle: 'reverse',
})
```

- `valueScaleType` 与 `valueScaleDelta` 控制 X 轴刻度范围。
- `barInfoStyle: 'reverse'` 可将图片放在条形左侧，适合展示头像或徽标。
- `barGap`、`leftLabelPadding` 等参数调节布局细节。
- `title` adds a centered heading above the stage, useful for distinguishing multiple charts.

## 渐隐策略

```ts
const config = new Config({
  maxRetentionTimeSec: 4,
  decayRate: 0.5,
  transitionDurationSec: 0.4,
})
```

- `maxRetentionTimeSec`：条目离开排名后仍停留的最长时间。
- `decayRate`：离开时数值衰减比例，用于制造衰落感。
- `transitionDurationSec`：退场动画时长，会自动限制在 `maxRetentionTimeSec / 2` 以内。

更多配置项的完整说明，请查看 [Config API](/reference/config)。当需要高级效果（如叠加 SVG、混合 Pixi 组件）时，可自定义容器并重用 `BarChart` 的更新逻辑。
