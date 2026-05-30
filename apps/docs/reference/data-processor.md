# DataProcessor

`DataProcessor` 提供将原始数据转换为动画帧序列的工具方法，方便与 `BarChart` 配合使用。

## `processCSV(path: string, config: Config): Promise<RankedData[][]>`

```ts
import { Config } from 'anichart-v4/Config'
import { DataProcessor } from 'anichart-v4/DataProcessor'

const config = new Config()
const frames = await DataProcessor.processCSV('/data/top-anime.csv', config)
```

- `path`：可通过 `fetch` 访问的 CSV 文件路径。若使用 bundler，可将文件放在公开目录。
- `config`：图表配置实例。`processCSV` 会使用其中的字段映射（如 `idField`、`labelField`、`valueField`、`stepField`）和动画参数（如 `topN`、`totalDurationSec`）。
- 返回值是一个 `RankedData[][]` 数组，每个元素表示一帧的排名内容，已按数值降序排列。

### 数据清洗流程

1. 读取 CSV 并构造 `Data` 对象。
2. 根据 `config.topN` 及数据出现次数过滤条目。
3. 对缺失帧进行插值，保证动画连贯。
4. 生成补帧，用于条目退出时的衰退效果。

### 错误处理

- 如果 `step` 无法解析为数字或合法日期，会抛出异常。
- 当 `transitionDurationSec` 超过上限时，会打印警告并自动调整。

## 自定义数据源

若数据已在应用中处理，可跳过 `processCSV`，直接生成 `RankedData[][]`：

```ts
import type { RankedData } from 'anichart-v4/Data'

const customFrames: RankedData[][] = [
  [
    { id: 'OnePiece', label: 'ONE PIECE', value: 120_000, step: 0, alpha: 1, raw: {}, up: true, rank: 0, blurRank: 0 },
  ],
]
```

确保每个 `RankedData` 包含 `rank` 与 `blurRank` 字段。可以复用 `DataProcessor` 内部逻辑作为参考，或调用其公开方法后进一步加工。

更多关于数据字段的说明见[数据准备](/guide/data-preparation)。
