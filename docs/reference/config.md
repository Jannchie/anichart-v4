# Config

`Config` 用于集中管理 AniChart v4 的渲染行为。构造函数接受一个 `Partial<IConfig>`，其余字段会采用默认值。

```ts
import { Config } from 'anichart-v4/Config'

const config = new Config({
  canvasWidth: 1280,
  canvasHeight: 720,
  topN: 15,
})
```

## Canvas 与布局

- `canvasWidth` / `canvasHeight`：Pixi 应用的画布尺寸。
- `backgroundColor`：背景色，十六进制整数。
- `x`, `y`：图表在画布中的起始坐标。
- `width`, `height`：图表可用区域，若未显式提供，则在构造函数内基于画布尺寸推导。
- `barGap` / `barHeight` / `autoBarHeight`：条目间距与高度控制，`autoBarHeight` 为 `true` 时会根据 `topN` 自动计算。
- `barInfoStyle`：`'default' | 'reverse'`，决定条内文本与图片的排列方式。
- `title`: Chart title text rendered at the centered top of the layout.

## 排名与动画

- `topN`：单帧展示的条目数量，额外保留一条用于平滑过渡。
- `fps`：目标帧率，用于插值生成帧。
- `totalDurationSec`：整个动画的目标时长。
- `swapDurationSec`：条目交换时的动画时长。
- `maxRetentionTimeSec`：条目退出排名后仍保留的时间。
- `transitionDurationSec`：退场动画时长，会自动限制在 `maxRetentionTimeSec / 2` 内。
- `decayRate`：条目退出时的数值衰减比例。

## 数值刻度

- `valueScaleType`：`'from-zero' | 'from-min' | 'from-delta'`，决定条形映射范围。
- `valueScaleDelta`：当 `valueScaleType` 为 `'from-delta'` 时，定义刻度窗口的宽度。
- `tickNum`：X 轴刻度数量。
- `xAxisLabel`：X 轴标题。

## 数据字段映射

- `idField` / `labelField` / `valueField` / `stepField`：对应原始数据列名。
- `imageField` / `colorField`：用于匹配 `textureMap` 与 `colorMap` 的字段。

## 钩子函数

每个钩子都会传入当前条目数据，可返回自定义内容：

- `getID(d)`、`getLabel(d)`、`getValue(d)`、`getStep(d)`：解析原始数据。通常无需修改，除非字段命名特殊。
- `getColor(d)`：覆盖颜色算法。
- `getValueLabel(d)` / `getValueExtra(d)`：条形末端的主、副数值文本。
- `getBarInfo(d, index, frame)`：条形内部显示的描述信息。
- `getStepLabel(step)`：定义右下角时间标签的格式。

## 资源与字体

- `fontFamily`：默认字体名称。
- `leftLabelPadding` / `valueLabelPadding` / `barInfoPadding`：细化布局。
- 配合 `textureMap` 与 `colorMap` 可引入自定义纹理与配色，详见[样式定制](/guide/customization)。

> 若需扩展新字段，可在构造函数参数中传入自定义函数或直接覆盖属性，`BarChart` 会在下一帧调用最新配置。
