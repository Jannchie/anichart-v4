# 数据准备

AniChart v4 依靠结构化数据驱动动画。建议使用 CSV 或 JSON 文件，只要能最终转换成 `RankedData[][]`。本文重点介绍 CSV 的字段要求与整理技巧。

## 必填字段

| 字段 | 说明 | 示例 |
| --- | --- | --- |
| `id` | 条目的唯一标识符，用于跟踪同一实体在不同时间的表现 | `OnePiece` |
| `label` | 展示在条形图左侧的名称 | `ONE PIECE` |
| `value` | 排名依据的数值，必须为数字 | `12345` |
| `step` | 时间或序列索引，可为数值或 ISO 日期字符串 | `2023-01-01` |

> `step` 字段会被自动解析：数值直接使用，日期字符串将通过 Day.js 转换为毫秒时间戳。

## 可选字段

- `color`：用于覆盖默认调色板。配合 `config.colorField` 或 `config.getColor` 使用。
- `image`：指向缩略图资源，搭配 `textureMap` 引用。
- 其他数值字段：将被自动附加到 `Data` 对象中，可在 `getBarInfo` 等钩子里使用。

## CSV 示例

```csv
id,label,value,step,color,image
OnePiece,ONE PIECE,120000,2020-01-01,#f76f8e,/covers/onepiece.png
OnePiece,ONE PIECE,130500,2020-02-01,#f76f8e,/covers/onepiece.png
Bleach,BLEACH,98000,2020-01-01,#6c5ce7,/covers/bleach.png
Bleach,BLEACH,102300,2020-02-01,#6c5ce7,/covers/bleach.png
```

确保同一 `id` 在多个 `step` 中重复出现，以便动画平滑过渡。

## 提示

- **数据去噪**：不需要的条目会在预处理阶段自动过滤。若想固定展示某些条目，可调高 `config.topN` 或调整 `maxRetentionTimeSec`。
- **采样频率**：`DataProcessor` 会按照 `config.totalDurationSec` 与 `fps` 插值生成中间帧。对于离散时间点，保持 `step` 间隔一致能获得更平滑的效果。
- **资源引用**：图片路径应能被浏览器访问。生产环境可使用 CDN 或提前加载纹理后写入 `textureMap`。

更多展示设置与钩子函数可参考[样式定制](/guide/customization)。若计划自行组织数据结构，可直接构造 `RankedData[][]` 并跳过 `DataProcessor`。
