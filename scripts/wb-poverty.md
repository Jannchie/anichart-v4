# wb-poverty.csv —— 各国极端贫困人口（数据说明 / 图注）

由 `scripts/update-worldbank-data.py` 的 `wb-poverty` 指标生成，输出到
`apps/{playground,studio}/public/wb-poverty.csv`，格式 `country,region,year,value`，
`value` 为**极端贫困人口数（人）**。用于 bar chart race。

**一句话结论**：1981 年中国约 **9.6 亿**人处于极端贫困、一柱独大；到 **2019 年清零**。
同期全球极端贫困重心从东亚转向撒哈拉以南非洲，中国一国贡献了全球减贫的约 **75%**。

---

## 数据来源与口径

| 项 | 值 |
|---|---|
| 来源 | World Bank **Poverty and Inequality Platform (PIP)** 官方 API |
| 取数 | `pip?country=all&povline=3&ppp_version=2021&fill_gaps=true`，`national` 级 |
| 人数 | `headcount`（贫困率）× `reporting_pop`（官方人口基数） |
| 贫困线 | **$3.00/天（2021 PPP）** —— 现行国际极端贫困线 |
| 时间 | **1981–2025 逐年**。`fill_gaps=true` 给「补齐」(lined-up)序列，**非 race 直线插值** |

> **口径提醒（勿混比）**：World Bank 的 `$1.90(2011 PPP) → $2.15(2017 PPP) → $3.00(2021 PPP)`
> 是**同一条极端贫困线随 PPP 基准的重定基**，不是三条不同门槛。本数据用 $3/天；它在实际
> 购买力上略高于旧线（2025-06 重定基把全球极端贫困上调约 1.25 亿），故起点数字比旧 $1.90
> 口径的估计略高。**图注务必标明 “World Bank PIP，$3/天 2021 PPP”**，不要与 “8 亿 / 7.7 亿”
> 等其它口径的头条数字画等号。

> **逐年值的三种来源（`estimation_type`，全部保留）**：`survey` 实测调查年 ·
> `interpolation` 两次调查之间的官方补齐（含印度 2012–21 空档）· `extrapolation` 末次调查之后的
> 官方 **nowcast/预测**。保留全部是为让每国逐年不断档（否则刚果金/坦桑等末次调查较早的贫困大国会
> 在近年消失）。代价见局限①。

## 可直接使用的图注 / 字幕

```
标题：极端贫困人口·各国（1981–2025）
副标题：中国如何让近十亿人摆脱极端贫困
数据：World Bank Poverty and Inequality Platform（极端贫困线 $3/天，2021 PPP；2023+ 含官方预测）
金句：中国一国贡献了全球极端贫困减少的约 75%；2019 年起降至 0。
```

## 多口径参考值（交叉验证用）

中国「极端贫困人口减少」在不同口径下数字不同，但相互自洽：

| 贫困线口径 | 起点 | 终点 | 减少 | 出处 |
|---|---|---|---|---|
| **$3.00/天 (2021 PPP)** | 9.6 亿 (1981) | 0 (2019) | ~9.6 亿 | World Bank PIP（本数据） |
| $1.90/天 (2011 PPP) | ~8.8 亿 | ~0 | **近 8 亿** | WB《四十年减贫》2022 |
| 国家线 (2010 不变价 2300 元) | — | 0 (2020) | **7.7 亿** | 国家统计局 / WB |
| $1/天 (旧口径) | 率 53% (1981) | 率 8% (2001) | >4 亿 | Ravallion-Chen 2007 |

- **中国占全球极端贫困减少约 75%（近 3/4）** —— World Bank《四十年减贫》核心结论。
- 印度轨迹（$3/天）：2010=3.9 亿 → 2015=2.3 亿 → 2019=1.2 亿 → 2022=0.9 亿（与 PIP 官方 lineup 一致）。

出处链接：
- WB《Four Decades of Poverty Reduction in China》(2022)：https://www.worldbank.org/en/news/press-release/2022/04/01/lifting-800-million-people-out-of-poverty-new-report-looks-at-lessons-from-china-s-experience
- Ravallion & Chen (2007)：https://cepr.org/voxeu/columns/historical-perspective-chinas-success-against-poverty
- 印度数据债 / 新估计 (Roy & van der Weide / CGD)：https://www.cgdev.org/publication/filling-gaping-hole-world-banks-global-poverty-measures-new-estimates-poverty-india
- 异见（income deflation 一派，New Political Economy 2023）：https://www.tandfonline.com/doi/full/10.1080/13563467.2023.2217087

## 已知局限

1. **2023–2025 对多数贫困国是 WB 预测（`extrapolation`）非实测**：多数贫困大国最后实测年是 2022
   （印度 HCES 2022-23、中国 2022）；之后用国民账户增长预测。富国（印尼/巴西/美国等年年调查）则有
   真实近年值。截到 2025（WB nowcast 视野；2026 多为占位/平推）。改 `POVERTY_MAX_YEAR` 可调；若只
   要实测，可在 `fetch_poverty` 重新过滤掉 `estimation_type=extrapolation`（但贫困大国近年会断档）。
2. **印度 2012–2021 是官方 interpolation**：印度此十年未公布消费调查，PIP 在 2011 与 2022(HCES) 两次
   调查间插值（2015≈2.3 亿、2019≈1.2 亿）。是 World Bank 官方填充，非原始调查，方法有学界争议（见 CGD）。
3. **少数国仅有少量调查**（如南苏丹、缅甸）：逐年仍给值，但多为插值/预测，可信度低于印度/中国。
4. **`COUNTRIES` 是所有 wb-* 指标的共享列表**：下次全量重跑时新增的 19 个贫困国也会进 population/co2
   等数据集（在那些指标里值极小、进不了 topN，无害）。本次只重生成了 `wb-poverty.csv`。
