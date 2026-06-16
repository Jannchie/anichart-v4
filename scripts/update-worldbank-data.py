#!/usr/bin/env python3
"""生成「各国 人口 / CO₂ 排放 / 军费 / 极端贫困人口」的 bar chart race（wb-*.csv）。

数据来自 World Bank 公开 API（无需 key），与 gdp.csv 同源同结构（country,region,year,value），
复用 playground 的国旗 + 中文名（datasets.ts 的 countryCode / countryZh）。

口径：
  · 人口      SP.POP.TOTL            —— 总人口（人）。印度 2023 反超中国。
  · CO₂ 排放  EN.GHG.CO2.MT.CE.AR5   —— 化石 CO₂（百万吨 Mt，AR5 口径；旧 EN.ATM.CO2E.KT 已停更）。
  · 军费      MS.MIL.XPND.CD         —— 军事支出（现价美元，源自 SIPRI）。

按 iso2 取数，用本文件的 COUNTRIES 决定显示名 / 大洲（不取 World Bank 的国名，保证与 gdp 一致）。
每国从首个有数据的年发到末年（缺年补空，race 自然淡入）。

用法：
  python3 scripts/update-worldbank-data.py            # 抓取并生成 wb-population/co2/military.csv

依赖：仅标准库。
"""
from __future__ import annotations

import csv
import io
import json
import sys
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PUB = (REPO / 'apps/playground/public', REPO / 'apps/studio/public')
UA = {'User-Agent': 'anichart-v4 worldbank dataset (jannchie@gmail.com)'}

# (iso2, 显示名(与 gdp/datasets.ts 一致), 大洲)。GDP 30 国 + 7 个人口/军费大国。
COUNTRIES = [
    ('AR', 'Argentina', 'South America'), ('AU', 'Australia', 'Oceania'),
    ('BE', 'Belgium', 'Europe'), ('BR', 'Brazil', 'South America'),
    ('CA', 'Canada', 'North America'), ('CN', 'China', 'Asia'),
    ('EG', 'Egypt', 'Africa'), ('FR', 'France', 'Europe'),
    ('DE', 'Germany', 'Europe'), ('IN', 'India', 'Asia'),
    ('ID', 'Indonesia', 'Asia'), ('IR', 'Iran', 'Asia'),
    ('IT', 'Italy', 'Europe'), ('JP', 'Japan', 'Asia'),
    ('MX', 'Mexico', 'North America'), ('NL', 'Netherlands', 'Europe'),
    ('NG', 'Nigeria', 'Africa'), ('PK', 'Pakistan', 'Asia'),
    ('PL', 'Poland', 'Europe'), ('RU', 'Russia', 'Europe'),
    ('SA', 'Saudi Arabia', 'Asia'), ('ZA', 'South Africa', 'Africa'),
    ('KR', 'South Korea', 'Asia'), ('ES', 'Spain', 'Europe'),
    ('SE', 'Sweden', 'Europe'), ('CH', 'Switzerland', 'Europe'),
    ('TH', 'Thailand', 'Asia'), ('TR', 'Türkiye', 'Asia'),
    ('GB', 'United Kingdom', 'Europe'), ('US', 'United States', 'North America'),
    ('BD', 'Bangladesh', 'Asia'), ('PH', 'Philippines', 'Asia'),
    ('VN', 'Vietnam', 'Asia'), ('ET', 'Ethiopia', 'Africa'),
    ('CD', 'DR Congo', 'Africa'), ('UA', 'Ukraine', 'Europe'),
    ('IL', 'Israel', 'Asia'),
    # 贫困 race 补充：近年极端贫困人口大国（多为撒哈拉以南非洲），让世界榜单更完整。
    # 它们在 CO₂/军费/电动车等指标里值很小、进不了 topN，对其它数据集无害。
    ('TZ', 'Tanzania', 'Africa'), ('MZ', 'Mozambique', 'Africa'),
    ('UG', 'Uganda', 'Africa'), ('KE', 'Kenya', 'Africa'),
    ('MG', 'Madagascar', 'Africa'), ('NE', 'Niger', 'Africa'),
    ('ZM', 'Zambia', 'Africa'), ('MW', 'Malawi', 'Africa'),
    ('AO', 'Angola', 'Africa'), ('GH', 'Ghana', 'Africa'),
    ('CI', "Côte d'Ivoire", 'Africa'), ('BF', 'Burkina Faso', 'Africa'),
    ('ML', 'Mali', 'Africa'), ('SS', 'South Sudan', 'Africa'),
    ('BI', 'Burundi', 'Africa'), ('NP', 'Nepal', 'Asia'),
    ('MM', 'Myanmar', 'Asia'), ('YE', 'Yemen', 'Asia'),
    ('CO', 'Colombia', 'South America'),
]
NAME = {iso: name for iso, name, _ in COUNTRIES}
REGION = {iso: region for iso, _, region in COUNTRIES}

# iso2 → iso3（OWID 用 iso3 的 code 列匹配）。
ISO3 = {
    'AR': 'ARG', 'AU': 'AUS', 'BE': 'BEL', 'BR': 'BRA', 'CA': 'CAN', 'CN': 'CHN', 'EG': 'EGY',
    'FR': 'FRA', 'DE': 'DEU', 'IN': 'IND', 'ID': 'IDN', 'IR': 'IRN', 'IT': 'ITA', 'JP': 'JPN',
    'MX': 'MEX', 'NL': 'NLD', 'NG': 'NGA', 'PK': 'PAK', 'PL': 'POL', 'RU': 'RUS', 'SA': 'SAU',
    'ZA': 'ZAF', 'KR': 'KOR', 'ES': 'ESP', 'SE': 'SWE', 'CH': 'CHE', 'TH': 'THA', 'TR': 'TUR',
    'GB': 'GBR', 'US': 'USA', 'BD': 'BGD', 'PH': 'PHL', 'VN': 'VNM', 'ET': 'ETH', 'CD': 'COD',
    'UA': 'UKR', 'IL': 'ISR',
    'TZ': 'TZA', 'MZ': 'MOZ', 'UG': 'UGA', 'KE': 'KEN', 'MG': 'MDG', 'NE': 'NER',
    'ZM': 'ZMB', 'MW': 'MWI', 'AO': 'AGO', 'GH': 'GHA', 'CI': 'CIV', 'BF': 'BFA',
    'ML': 'MLI', 'SS': 'SSD', 'BI': 'BDI', 'NP': 'NPL', 'MM': 'MMR', 'YE': 'YEM',
    'CO': 'COL',
}
ISO3_TO_ISO2 = {v: k for k, v in ISO3.items()}

# (输出名, indicator, 值变换)。CO₂ 原始单位 Mt 直接用；人口/军费原样。
METRICS = [
    ('wb-population', 'SP.POP.TOTL', lambda v: round(v)),
    ('wb-co2', 'EN.GHG.CO2.MT.CE.AR5', lambda v: round(v, 1)),
    ('wb-military', 'MS.MIL.XPND.CD', lambda v: round(v)),
]

# Our World in Data grapher（World Bank 已停更的能源/环保指标）。这几个中国都是断层第一。
# (输出名, grapher slug, 值变换)。CSV 列固定为 entity,code(iso3),year,<单值>。
OWID_METRICS = [
    ('wb-electricity', 'electricity-generation', lambda v: round(v, 1)),      # 发电量 TWh
    ('wb-solar', 'solar-energy-consumption', lambda v: round(v, 1)),          # 太阳能发电 TWh
    ('wb-wind', 'wind-generation', lambda v: round(v, 1)),                    # 风能发电 TWh
    ('wb-ev', 'electric-car-sales', lambda v: round(v)),                      # 电动车销量 辆/年
]

# 各国极端贫困「人数」直接取 World Bank PIP API：贫困率(headcount) × 官方人口(reporting_pop)。
# fill_gaps=true → 逐年「补齐」(lined-up)序列：调查间用官方 interpolation 填充（含印度 2012–21
# 空档），末次调查之后用 extrapolation（官方 nowcast/预测），不再靠 race 直线插值。
# 口径：$3.00/天 (2021 PPP) 现行国际极端贫困线，national 级。中国 1981=97% → 2019 起为 0。
POVERTY_PPP = 2021
POVERTY_LINE = 3
# 保留全部 estimation_type（survey/interpolation/extrapolation/CMD），这样每国逐年都有值（含贫困
# 大国），榜单不因「只有富国年年调查」而失真。但 2023–2025 对多数贫困国是 WB「预测」非实测
# （见 wb-poverty.md 局限）。截到 2025（WB nowcast 视野；2026 多为占位/平推）。
POVERTY_MAX_YEAR = 2025


def fetch(indicator: str) -> list[tuple[str, int, float]]:
    """一次取所有国家某指标的全部年份。返回 (iso2, year, value)。"""
    iso = ';'.join(iso for iso, _, _ in COUNTRIES)
    url = (f'https://api.worldbank.org/v2/country/{iso}/indicator/{indicator}'
           f'?format=json&per_page=20000')
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.load(r)
    out = []
    for x in data[1] or []:
        if x['value'] is not None and x['countryiso3code']:
            out.append((x['country']['id'], int(x['date']), float(x['value'])))
    return out


def fetch_owid(slug: str) -> list[tuple[str, int, float]]:
    """OWID grapher CSV（entity,code(iso3),year,值）→ 转成 (iso2, year, value)，只留我的国家。"""
    url = f'https://ourworldindata.org/grapher/{slug}.csv?csvType=full&useColumnShortNames=true'
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (anichart-v4)'})
    with urllib.request.urlopen(req, timeout=60) as r:
        rd = list(csv.reader(io.StringIO(r.read().decode('utf-8'))))
    out = []
    for row in rd[1:]:
        if len(row) > 3 and row[1] in ISO3_TO_ISO2 and row[3] not in ('', 'NA'):
            out.append((ISO3_TO_ISO2[row[1]], int(row[2]), float(row[3])))
    return out


def fetch_poverty() -> list[tuple[str, int, float]]:
    """World Bank PIP（fill_gaps 逐年补齐）→ 各国极端贫困人口数（iso2, year, 人数）。
    人数 = headcount × reporting_pop（官方口径）；取 national 级，截到 POVERTY_MAX_YEAR。"""
    url = (f'https://api.worldbank.org/pip/v1/pip?country=all&year=all'
           f'&povline={POVERTY_LINE}&ppp_version={POVERTY_PPP}&fill_gaps=true&format=csv')
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=180) as r:
        rd = list(csv.reader(io.StringIO(r.read().decode('utf-8'))))
    h = rd[0]
    iC, iY, iHC = h.index('country_code'), h.index('reporting_year'), h.index('headcount')
    iRP, iRL = h.index('reporting_pop'), h.index('reporting_level')
    seen, out = set(), []
    for row in rd[1:]:
        code = row[iC]
        if code not in ISO3_TO_ISO2 or row[iRL] != 'national':
            continue
        try:
            iso, year, n = ISO3_TO_ISO2[code], int(row[iY]), float(row[iHC]) * float(row[iRP])
        except ValueError:
            continue
        if year > POVERTY_MAX_YEAR or (iso, year) in seen:  # 截断预测/富国偏置段；防御重复 spell
            continue
        seen.add((iso, year))
        out.append((iso, year, n))
    return out


def build_rows(raw: list[tuple[str, int, float]], transform) -> list[dict]:
    by_country: dict[str, dict[int, float]] = {}
    for iso, year, val in raw:
        if iso in NAME:
            by_country.setdefault(iso, {})[year] = val
    rows = []
    for iso, years in by_country.items():
        lo, hi = min(years), max(years)
        for y in range(lo, hi + 1):
            if y in years:  # 缺年跳过（race 会插值）
                rows.append({'country': NAME[iso], 'region': REGION[iso],
                             'year': y, 'value': transform(years[y])})
    rows.sort(key=lambda r: (r['year'], r['country']))
    return rows


def write_rows(rows: list[dict], base: str) -> None:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=['country', 'region', 'year', 'value'])
    w.writeheader()
    w.writerows(rows)
    data = buf.getvalue()
    for d in PUB:
        (d / f'{base}.csv').write_text(data, encoding='utf-8')
    print(f'  {base}: {len(rows):,} rows ({rows[0]["year"]}..{rows[-1]["year"]})')


def main() -> None:
    jobs = ([('wb', b, ind, t) for b, ind, t in METRICS]
            + [('owid', b, s, t) for b, s, t in OWID_METRICS]
            + [('poverty', 'wb-poverty', 'pip', lambda v: round(v))])
    for src, base, key, transform in jobs:
        try:
            raw = fetch(key) if src == 'wb' else fetch_poverty() if src == 'poverty' else fetch_owid(key)
            rows = build_rows(raw, transform)
            if rows:
                write_rows(rows, base)
            else:
                print(f'  {base}: 无数据', file=sys.stderr)
        except Exception as e:  # noqa: BLE001
            print(f'  {base} [{key}] ERR {type(e).__name__}: {e}', file=sys.stderr)


if __name__ == '__main__':
    main()
