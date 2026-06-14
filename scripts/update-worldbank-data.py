#!/usr/bin/env python3
"""生成「各国 人口 / CO₂ 排放 / 军费」的 bar chart race（wb-*.csv）。

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
    jobs = [('wb', b, ind, t) for b, ind, t in METRICS] + [('owid', b, s, t) for b, s, t in OWID_METRICS]
    for src, base, key, transform in jobs:
        try:
            raw = fetch(key) if src == 'wb' else fetch_owid(key)
            rows = build_rows(raw, transform)
            if rows:
                write_rows(rows, base)
            else:
                print(f'  {base}: 无数据', file=sys.stderr)
        except Exception as e:  # noqa: BLE001
            print(f'  {base} [{key}] ERR {type(e).__name__}: {e}', file=sys.stderr)


if __name__ == '__main__':
    main()
