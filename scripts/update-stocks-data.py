#!/usr/bin/env python3
"""生成「美国大盘股市值」的 bar chart race（stocks.csv）。

市值是 split-invariant 的量：market_cap = 股价 × 流通股数。难点全在「两个数据源
口径不一致」上，本脚本的核心就是把它们对齐到同一个拆股基准：

  · 股价：Yahoo Finance 月线 `quote.close`，是「按今天的拆股基准回溯复权」的价
    （AAPL 2014-05 显示 $22.61，即实际 $600 ÷ 7 ÷ 4，把后续两次拆股都折进去了）。
  · 股数：SEC EDGAR XBRL，是「申报当时的实际股数」。

直接相乘会重复计入拆股。正确做法：把每个 SEC 股数点按它**申报日（filed）之后**发生的
累计拆股因子放大到「今天的拆股基准」，再乘 Yahoo 的今基准复权价。用 filed 日而非报告
期末日（end）是关键——后期 filing 会把早期 end 的股数按拆股后口径重述，只有 filed 日
才忠实反映该数字写下时的拆股口径。

股数三级兜底（companyconcept API 不暴露按股权 class 维度拆分的概念，故需兜底）：
  1. dei:EntityCommonStockSharesOutstanding —— 封面流通股数，时点值，最干净，多数公司命中。
  2. us-gaap:CommonStockSharesOutstanding —— 资产负债表股数（如 Alphabet）。
  3. us-gaap:WeightedAverageNumberOfDilutedSharesOutstanding —— 算 EPS 的加权稀释股数，
     把所有股权 class 聚合成单一经济股数，几乎每家都报（如 Meta，双重股权且不报前两个概念）。

口径与限制（要诚实标注）：
  · 起点 2010-01：SEC XBRL 强制申报约从 2009 年起，更早没有结构化股数。这段恰好覆盖最
    精彩的故事（2011 ExxonMobil 称王 → Apple → Microsoft → 如今 Nvidia/Apple/Microsoft 三强）。
  · 月度采样，股数按季度申报前向填充。加权稀释股数比时点股数略高（含期权/RSU），<2%，不影响观感。
  · 因 CIK 在企业重组后会换号（Disney 2019、Broadcom 2018），这些公司的数据从重组后才开始——
    在 race 里表现为中途淡入，符合 bar chart race 语义。
  · Berkshire 的 A/B 双重股权是 1500:1 非等价比例，简单求和无意义，故未纳入。
  · 单季度 SEC 数据故障会造成市值尖刺，build_series 末尾有 despike 守卫回填孤立异常点。

数据来源需署名 SEC EDGAR（https://www.sec.gov/edgar）与 Yahoo Finance。

用法：
  python3 scripts/update-stocks-data.py            # 生成 stocks.csv（仅标准库）
  BRANDFETCH_CLIENT_ID=xxx python3 scripts/update-stocks-data.py --logos
                                                   # 取公司 logo（Brandfetch CDN）到 public/logos

依赖：数据生成仅标准库；--logos 额外需要 Pillow + resvg-py（pip 纯 wheel）与 Brandfetch Logo Link
     client-id（见 download_logos）。
"""
from __future__ import annotations

import bisect
import csv
import datetime as dt
import io
import json
import os
import re
import sys
import time
import urllib.request
from collections import defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PLAYGROUND = REPO / 'apps/playground/public'
OUTPUTS = [PLAYGROUND / 'stocks.csv', REPO / 'apps/studio/public/stocks.csv']
LOGO_DIRS = [REPO / 'apps/playground/public/logos', REPO / 'apps/studio/public/logos']

UA = {'User-Agent': 'anichart-v4 stocks dataset (jannchie@gmail.com)'}
START = dt.date(2000, 1, 1)            # race 起点；2009 后用 XBRL，2000–2009 用老 10-K 封面
SEC_DELAY = 0.13                       # SEC 限速：<10 req/s
TENK_FORMS = ('10-K', '10-K405', '10-KSB')  # 含老式年报变体

# 展示名 | Yahoo/SEC ticker（双重股权用连字符，如 BRK-B）| logo 域名。
# 选取标准：曾经或如今进过美股市值前 ~20，能凑出有换位张力的 race
# （巨头沉浮 + AI 时代的爆发）。展示名同时是配色 / logo 的 key（见 datasets.ts）。
UNIVERSE = [
    ('Apple', 'AAPL', 'apple.com'),
    ('Microsoft', 'MSFT', 'microsoft.com'),
    ('Alphabet', 'GOOGL', 'abc.xyz'),
    ('Amazon', 'AMZN', 'amazon.com'),
    ('Nvidia', 'NVDA', 'nvidia.com'),
    ('Meta', 'META', 'meta.com'),
    ('Broadcom', 'AVGO', 'broadcom.com'),
    ('Tesla', 'TSLA', 'tesla.com'),
    ('JPMorgan Chase', 'JPM', 'jpmorganchase.com'),
    ('Eli Lilly', 'LLY', 'lilly.com'),
    ('Visa', 'V', 'visa.com'),
    ('ExxonMobil', 'XOM', 'exxonmobil.com'),
    ('Walmart', 'WMT', 'walmart.com'),
    ('Mastercard', 'MA', 'mastercard.com'),
    ('UnitedHealth', 'UNH', 'unitedhealthgroup.com'),
    ('Oracle', 'ORCL', 'oracle.com'),
    ('Johnson & Johnson', 'JNJ', 'jnj.com'),
    ('Procter & Gamble', 'PG', 'pg.com'),
    ('Home Depot', 'HD', 'homedepot.com'),
    ('Costco', 'COST', 'costco.com'),
    ('Chevron', 'CVX', 'chevron.com'),
    ('Coca-Cola', 'KO', 'coca-colacompany.com'),
    ('Bank of America', 'BAC', 'bankofamerica.com'),
    ('Citigroup', 'C', 'citigroup.com'),
    ('Netflix', 'NFLX', 'netflix.com'),
    ('Salesforce', 'CRM', 'salesforce.com'),
    ('AMD', 'AMD', 'amd.com'),
    ('PepsiCo', 'PEP', 'pepsico.com'),
    ('Adobe', 'ADBE', 'adobe.com'),
    ('Qualcomm', 'QCOM', 'qualcomm.com'),
    ('Disney', 'DIS', 'disney.com'),
    ('Cisco', 'CSCO', 'cisco.com'),
    ('Intel', 'INTC', 'intel.com'),
    ('Pfizer', 'PFE', 'pfizer.com'),
    ('GE', 'GE', 'ge.com'),
    ('IBM', 'IBM', 'ibm.com'),
    ('AT&T', 'T', 'att.com'),
    ('Verizon', 'VZ', 'verizon.com'),
    ('Wells Fargo', 'WFC', 'wellsfargo.com'),
    ("McDonald's", 'MCD', 'mcdonalds.com'),
    ('AbbVie', 'ABBV', 'abbvie.com'),
    ('Merck', 'MRK', 'merck.com'),
]

SHARE_CONCEPTS = [
    'dei/EntityCommonStockSharesOutstanding',
    'us-gaap/CommonStockSharesOutstanding',
    'us-gaap/WeightedAverageNumberOfDilutedSharesOutstanding',
]

# ── SpaceX：私有→2026-06 上市，特殊处理（无 SEC XBRL，走独立路径）──
# 口径要诚实标注：上市前用「公开报道的私募轮/要约收购 post-money 估值」阶梯（来源 Wikipedia
# 等公开报道），与公开市值不同口径（私募估值无每日流动性、含流动性折价），但能完整呈现 SpaceX
# 从 $12B 到史上最大 IPO 的轨迹。上市后用真实公开市值 = SPCX 月线 × 流通股数。
SPACEX_ROUNDS = [          # (日期, post-money 估值 USD)，估值只在轮次跳变，月度前向填充
    ('2015-01-01', 12e9), ('2017-07-01', 21e9), ('2019-05-01', 33e9),
    ('2020-08-01', 46e9), ('2021-02-01', 74e9), ('2021-10-01', 100e9),
    ('2022-07-01', 127e9), ('2023-07-01', 150e9), ('2023-12-01', 180e9),
    ('2024-06-01', 210e9), ('2024-12-01', 350e9),
]
SPACEX_IPO = dt.date(2026, 6, 11)   # 2026-06-11 定价、06-12 开盘，IPO 估值 $1.77T（史上最大）
SPACEX_SHARES = 13.09e9             # 上市后流通股（含多 class），来源 stockanalysis.com


def http_json(url: str, retries: int = 3) -> dict:
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.load(resp)
        except Exception:
            if attempt == retries - 1:
                raise
            time.sleep(0.6 * (attempt + 1))
    raise RuntimeError('unreachable')


def http_bytes(url: str, retries: int = 3) -> bytes:
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=35) as resp:
                return resp.read()
        except Exception:
            if attempt == retries - 1:
                raise
            time.sleep(0.6 * (attempt + 1))
    raise RuntimeError('unreachable')


def resolve_ciks() -> dict[str, int]:
    data = http_json('https://www.sec.gov/files/company_tickers.json')
    return {v['ticker']: v['cik_str'] for v in data.values()}


def fetch_prices(symbol: str) -> tuple[list[tuple[dt.date, float]], list[tuple[dt.date, float]]]:
    """Yahoo 月线复权收盘价 + 拆股事件（今基准）。"""
    p1 = int(dt.datetime(START.year - 1, 12, 1).timestamp())
    p2 = int(dt.datetime.now().timestamp())
    url = (f'https://query1.finance.yahoo.com/v8/finance/chart/{symbol}'
           f'?period1={p1}&period2={p2}&interval=1mo&events=splits')
    r = http_json(url)['chart']['result'][0]
    ts = r['timestamp']
    close = r['indicators']['quote'][0]['close']
    prices = [(dt.date.fromtimestamp(t), c) for t, c in zip(ts, close) if c is not None]
    splits = sorted(
        (dt.date.fromtimestamp(v['date']), v['numerator'] / v['denominator'])
        for v in r.get('events', {}).get('splits', {}).values()
    )
    return prices, splits


def cum_split_after(splits: list[tuple[dt.date, float]], d: dt.date) -> float:
    """d 之后发生的累计拆股因子——把当时股数放大到今天的拆股基准。"""
    f = 1.0
    for sd, ratio in splits:
        if sd > d:
            f *= ratio
    return f


def fetch_shares(cik: int, splits: list[tuple[dt.date, float]]) -> tuple[str, list[tuple[dt.date, float]]]:
    """三级兜底取流通股数，按 filed 日拆股因子归一到今基准。返回 (命中概念, [(end_date, adj_shares)])。"""
    for concept in SHARE_CONCEPTS:
        url = f'https://data.sec.gov/api/xbrl/companyconcept/CIK{cik:010d}/{concept}.json'
        time.sleep(SEC_DELAY)
        try:
            data = http_json(url, retries=2)
        except Exception:
            continue
        # 同一 filing(accn) 内把同 end 的多 class 求和（双重股权封面分行报告）；记录 filed 日。
        per_filing: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
        filed_date: dict[str, str] = {}
        for arr in data['units'].values():
            for a in arr:
                per_filing[a['accn']][a['end']] += a['val']
                filed_date[a['accn']] = a['filed']
        # 每个 end 取「filed 最晚」的 filing（最完整/已重述），并按其 filed 日做拆股归一。
        best: dict[str, tuple[float, dt.date]] = {}
        for accn, ends in per_filing.items():
            fd = dt.date.fromisoformat(filed_date[accn])
            for end, val in ends.items():
                if end not in best or fd > best[end][1]:
                    best[end] = (val, fd)
        items = sorted(best.items())
        ends = [dt.date.fromisoformat(e) for e, _ in items]
        vals = despike([v * cum_split_after(splits, fd) for _, (v, fd) in items])
        series = list(zip(ends, vals))
        if series:
            return concept.split('/')[1], series
    return '', []


def _http_text(url: str) -> str:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=35) as resp:
        return resp.read().decode('utf-8', 'ignore')


def _list_filings(cik: int) -> list[tuple[str, str, str, str]]:
    """全部历史申报 (form, accession, primaryDoc, filingDate)，合并 recent + 老文件块。"""
    sub = http_json(f'https://data.sec.gov/submissions/CIK{cik:010d}.json')
    out: list[tuple[str, str, str, str]] = []

    def add(block: dict) -> None:
        for i in range(len(block['form'])):
            out.append((block['form'][i], block['accessionNumber'][i],
                        block['primaryDocument'][i], block['filingDate'][i]))
    add(sub['filings']['recent'])
    for fb in sub['filings'].get('files', []):
        time.sleep(SEC_DELAY)
        add(http_json(f"https://data.sec.gov/submissions/{fb['name']}"))
    return out


_TOK = re.compile(r'([\d]{1,3}(?:,[\d]{3}){1,4}|[\d]{7,})\s*(million|billion)?')


def _tenk_candidates(cik: int, acc: str, doc: str) -> list[float]:
    """从老 10-K 封面提取「流通股数」候选（今基准前的 raw 数）。

    跨公司封面措辞差异极大（'X million shares ... outstanding' / 'shares outstanding as of
    [date] N' / 'number of shares ... outstanding: N'），与其写完美正则，不如松散地把封面里
    所有「shares + outstanding 上下文内、且不紧邻 authorized」的数字都当候选，交给上层用 2009
    XBRL 锚点 + 年际连续性挑出正确的那个（授权股数/美元金额会被容差剔除）。"""
    a = acc.replace('-', '')
    urls = ([f'https://www.sec.gov/Archives/edgar/data/{cik}/{a}/{doc}'] if doc else [])
    urls.append(f'https://www.sec.gov/Archives/edgar/data/{cik}/{a}.txt')  # 老式全文兜底
    for url in urls:
        try:
            html = _http_text(url)
        except Exception:
            continue
        text = re.sub(r'<[^>]+>', ' ', html)
        text = re.sub(r'&nbsp;|&#160;|&#32;|&#146;', ' ', text)
        low = re.sub(r'\s+', ' ', text).lower()[:18000]
        cands: list[float] = []
        for m in _TOK.finditer(low):
            n = float(m.group(1).replace(',', ''))
            if m.group(2) == 'billion':
                n *= 1e9
            elif m.group(2) == 'million':
                n *= 1e6
            if not (1e8 <= n <= 6e10):
                continue
            # 前向窗口放宽到 200：老式表格封面（IBM 等）「shares outstanding」是列头、
            # 数字在隔着类名/表头的单元里。多余候选由上层锚点+连续性筛掉，故放宽安全。
            ctx = low[max(0, m.start() - 200):m.start()] + low[m.end():m.end() + 70]
            if 'shares' in ctx and 'outstanding' in ctx and 'authorized' not in low[max(0, m.start() - 45):m.start()]:
                cands.append(n)
        if cands:
            return cands
    return []


def fetch_pre2009_shares(cik: int, splits: list[tuple[dt.date, float]],
                         anchor: float, cutoff: dt.date) -> list[tuple[dt.date, float]]:
    """从老 10-K 重建 pre-cutoff 的今基准股数序列，锚点(最早 XBRL 值)+连续性挑选候选。"""
    filings = sorted((f for f in _list_filings(cik) if f[0] in TENK_FORMS and f[3] < '2010'),
                     key=lambda x: x[3])
    per_year: list[tuple[dt.date, list[float]]] = []
    for _, acc, doc, fd in filings:
        fdate = dt.date.fromisoformat(fd)
        try:
            cands = _tenk_candidates(cik, acc, doc)
        except Exception:
            cands = []
        if cands:
            f = cum_split_after(splits, fdate)
            per_year.append((fdate, [c * f for c in cands]))
        time.sleep(0.03)
    # 新→旧：每年取与 target（上一年/锚点）最接近且在 ±(−45%,+70%) 内的候选（股数年际变动有限，
    # 拆股已并入调整，故真实股数不会跳变；授权/美元金额落在容差外被弃）。
    picked: list[tuple[dt.date, float]] = []
    target = anchor
    for fdate, adj in reversed(per_year):
        good = [v for v in adj if 0.55 * target <= v <= 1.7 * target]
        if good:
            v = min(good, key=lambda x: abs(x - target))
            if fdate < cutoff:
                picked.append((fdate, v))
            target = v
    picked.sort()
    return picked


def despike(vals: list[float]) -> list[float]:
    """剔除 SEC 单季数据故障（如 Qualcomm 2011 连续两季把股数错报 1000×），在好邻点间线性插值。

    用「全序列中位数」判离群而非「相邻点比值」：相邻两个坏点会互相掩护，把夹在中间的好点
    误判成塌陷（邻点比值法的死角）；中位数不受少数离群点影响，稳。仅用于流通股数——股数序列
    16 年内合法变动通常 <3×（回购/增发），10× 带宽稳稳放过合法变动、揪出 1000× 故障；市值有
    NVDA 9B→5T 的 550× 合法增长，不能套这个判据，故不在市值层去尖刺。"""
    n = len(vals)
    if n < 5:
        return list(vals)
    med = sorted(vals)[n // 2]
    if med <= 0:
        return list(vals)
    good = [i for i, v in enumerate(vals) if med / 10 <= v <= 10 * med]
    if len(good) < 2:
        return list(vals)
    out = list(vals)
    for i in range(n):
        if med / 10 <= vals[i] <= 10 * med:
            continue
        left = max((g for g in good if g < i), default=None)
        right = min((g for g in good if g > i), default=None)
        if left is not None and right is not None:
            t = (i - left) / (right - left)
            out[i] = vals[left] * (1 - t) + vals[right] * t
        elif left is not None:
            out[i] = vals[left]
        elif right is not None:
            out[i] = vals[right]
    return out


def build_series(company: str, ticker: str,
                 prices: list[tuple[dt.date, float]],
                 shares: list[tuple[dt.date, float]]) -> list[dict]:
    """月度市值 = 复权价 × 前向填充的今基准股数（仅在两源都已有数据后）。"""
    sh_dates = [d for d, _ in shares]
    sh_vals = [v for _, v in shares]

    def shares_at(d: dt.date) -> float | None:
        i = bisect.bisect_right(sh_dates, d) - 1
        return sh_vals[i] if i >= 0 else None

    raw: list[tuple[int, float]] = []
    for d, close in prices:
        if d < START:
            continue
        s = shares_at(d)
        if s is None or s <= 0:
            continue
        ts = int(dt.datetime(d.year, d.month, d.day).timestamp())
        raw.append((ts, close * s))
    return [{'company': company, 'ticker': ticker, 'marketcap': round(mc), 'date': ts}
            for ts, mc in raw]


def write_rows(rows: list[dict]) -> None:
    rows.sort(key=lambda r: (r['date'], -r['marketcap']))
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=['company', 'ticker', 'marketcap', 'date'])
    w.writeheader()
    w.writerows(rows)
    for path in OUTPUTS:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(buf.getvalue())
        print(f'wrote {len(rows)} rows -> {path.relative_to(REPO)}')


# ── 公司 logo：Brandfetch CDN（矢量 SVG 优先，栅格兜底）──────────────────
# 之前用 Google favicon，但 favicon 是「网站小图标」不是品牌 logo，分辨率乱、近半数糊。
# 现按域名取 Brandfetch（公开 client-id，非配额制的 Brand API），每家取其 logo 变体：
#   ① 矢量 SVG → resvg 高分栅格化：原生透明 + 矢量抗锯齿，边缘干净（首选）。
#   ② 无矢量（只有栅格 webp/png，如 P&G/PepsiCo/McDonald's）或 SVG 无有效尺寸（如 Amazon，
#      resvg 报错）→ 退到高分栅格 PNG。
# **全程不抠图/不去底**——矢量与栅格源本就透明，直接转 PNG。
#
# 关键坑：Brandfetch 对「品牌没有的变体」不报 404，而是返回占位（'symbol' 的「B」、缺失 light 的
# 「Brandfetch」字标等），占位也是合法 SVG/透明 PNG、无法可靠靠程序识别。图表背景深色，多数品牌的
# 默认 logo 是深色版（深背景上隐形），其 'theme/light/logo'（浅色版）才合适——故**默认用
# theme/light/logo**；少数公司没有真实 light 变体（light 返回占位），在 LOGO_SPEC_OVERRIDE 里点名
# 回退到默认 'logo'（它们的默认版本身彩色、深背景上可见）。这套 spec 映射是对这 43 家逐个肉眼核验
# 出来的（universe 固定、极少变动，一次性成本）。
#
# 依赖：Pillow + resvg-py（均 pip 纯 wheel，仅此 --logos 路径用）、环境变量 BRANDFETCH_CLIENT_ID
# （Brandfetch 账号的 Logo Link client-id，公开值，可在 brandfetch 后台取得）。
BF_SVG = 'https://cdn.brandfetch.io/{domain}/{spec}.svg?c={cid}'
BF_PNG = 'https://cdn.brandfetch.io/{domain}/w/1024/h/1024/{spec}.png?c={cid}'
LOGO_RENDER_WIDTH = 1024                        # resvg 栅格化宽度（保纵横比），供降采样得平滑边缘
LOGO_MAX_SIDE = 512                             # 最终 PNG 最长边上限
DEFAULT_SPECS = ['theme/light/logo']            # 浅色版，深背景上清晰（多数公司适用）
# 无真实 light 变体（theme/light/logo 返回占位）的公司 → 用默认彩色 'logo'（已肉眼核验可见）。
LOGO_SPEC_OVERRIDE = {
    'Microsoft': ['logo'],
    'Procter & Gamble': ['logo'],
    'Home Depot': ['logo'],
    'Costco': ['logo'],
    'Chevron': ['logo'],
    'Bank of America': ['logo'],
    'Salesforce': ['logo'],
}


def _fetch_logo_svg(domain: str, spec: str, cid: str) -> bytes | None:
    """取一个变体的矢量 SVG；404/失败、或返回的不是 SVG（个别 logo 实为栅格）时返回 None。"""
    try:
        raw = http_bytes(BF_SVG.format(domain=domain, spec=spec, cid=cid))
    except Exception:
        return None
    return raw if b'<svg' in raw[:512] else None


def _vector_image(svg: bytes):
    """resvg 矢量栅格化为 RGBA（保纵横比、原生透明、抗锯齿）。失败抛异常。"""
    import importlib
    from PIL import Image
    resvg = importlib.import_module('resvg_py')        # 动态 import 避免静态缺失依赖告警
    png = bytes(resvg.svg_to_bytes(svg_string=svg.decode('utf-8'), width=LOGO_RENDER_WIDTH))
    return Image.open(io.BytesIO(png)).convert('RGBA')


def _raster_image(domain: str, spec: str, cid: str):
    """取高分栅格 PNG 为 RGBA（不抠图）。404/失败返回 None。"""
    from PIL import Image
    try:
        raw = http_bytes(BF_PNG.format(domain=domain, spec=spec, cid=cid))
    except Exception:
        return None
    try:
        return Image.open(io.BytesIO(raw)).convert('RGBA')
    except Exception:
        return None


def _finish(im):
    """裁掉透明边 + 限制最长边到 LOGO_MAX_SIDE。"""
    from PIL import Image
    bbox = im.getbbox()
    if bbox:
        im = im.crop(bbox)
    if max(im.size) > LOGO_MAX_SIDE:
        s = LOGO_MAX_SIDE / max(im.size)
        im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.Resampling.LANCZOS)
    return im


def _pick_logo(domain: str, company: str, cid: str):
    """按 spec 顺序取该公司 logo：先试矢量 SVG（resvg 渲染），失败/非矢量则退高分栅格 PNG。
    返回首个成功的 RGBA 图，全失败返回 None。只请求品牌确有的变体，故不会拿到 Brandfetch 占位。"""
    for spec in LOGO_SPEC_OVERRIDE.get(company, DEFAULT_SPECS):
        svg = _fetch_logo_svg(domain, spec, cid)
        if svg:
            try:
                return _finish(_vector_image(svg))
            except Exception:
                pass
        im = _raster_image(domain, spec, cid)
        if im is not None:
            return _finish(im)
    return None


def download_logos() -> None:
    """为 UNIVERSE + SpaceX 取高清透明品牌 logo（Brandfetch CDN），覆盖写入 public/logos/ 并镜像。"""
    cid = os.environ.get('BRANDFETCH_CLIENT_ID')
    if not cid:
        raise SystemExit('需要环境变量 BRANDFETCH_CLIENT_ID（Brandfetch Logo Link client-id）')
    for d in LOGO_DIRS:
        d.mkdir(parents=True, exist_ok=True)
    primary, *mirrors = LOGO_DIRS
    # SpaceX 走独立路径不在 UNIVERSE 里，logo 单独补
    for company, _, domain in [*UNIVERSE, ('SpaceX', 'SPCX', 'spacex.com')]:
        im = _pick_logo(domain, company, cid)
        if im is None:
            print(f'skip {company}: no usable logo from {domain}')
            continue
        dest = primary / f'{company}.png'
        im.save(dest)
        for m in mirrors:
            im.save(m / dest.name)
        print(f'logo {company:18s} <- {domain:24s} {im.size[0]}x{im.size[1]}')


def spacex_rows() -> list[dict]:
    """SpaceX 独立路径：上市前私募轮估值阶梯（前向填充）+ 上市后 SPCX 真实公开市值。"""
    rows: list[dict] = []
    rounds = [(dt.date.fromisoformat(d), v) for d, v in SPACEX_ROUNDS]
    ipo_month = SPACEX_IPO.replace(day=1)
    d = rounds[0][0]
    while d < ipo_month:                      # 私募阶段：估值只在轮次跳变，月度前向填充
        val = next((v for rd, v in reversed(rounds) if rd <= d), None)
        if val:
            ts = int(dt.datetime(d.year, d.month, 1).timestamp())
            rows.append({'company': 'SpaceX', 'ticker': 'SPCX', 'marketcap': round(val), 'date': ts})
        d = (d.replace(day=1) + dt.timedelta(days=32)).replace(day=1)
    try:                                      # 公开阶段：SPCX 月线收盘 × 流通股数
        prices, _ = fetch_prices('SPCX')
        for pd, close in prices:
            if pd < ipo_month:
                continue
            ts = int(dt.datetime(pd.year, pd.month, pd.day).timestamp())
            rows.append({'company': 'SpaceX', 'ticker': 'SPCX',
                         'marketcap': round(close * SPACEX_SHARES), 'date': ts})
    except Exception as e:
        print(f'!! SpaceX SPCX fetch failed: {e}')
    print(f'{"SpaceX":18s} {"SPCX":5s} [{"private+IPO":14s}] {len(rows):3d} mo')
    return rows


def main() -> None:
    if '--logos' in sys.argv:
        download_logos()
        return

    ciks = resolve_ciks()
    all_rows: list[dict] = []
    for company, ticker, _ in UNIVERSE:
        cik = ciks.get(ticker)
        if cik is None:
            print(f'!! no CIK for {company} ({ticker}), skip')
            continue
        try:
            prices, splits = fetch_prices(ticker)
            concept, shares = fetch_shares(cik, splits)
        except Exception as e:
            print(f'!! {company} ({ticker}) fetch failed: {e}')
            continue
        if not shares:
            print(f'!! {company} ({ticker}) no shares data, skip')
            continue
        # 用老 10-K 封面把股数往 2009 前延伸（锚点 = 最早 XBRL 值；失败/抓不到则该公司从 2009 起）
        pre = []
        try:
            pre = fetch_pre2009_shares(cik, splits, shares[0][1], shares[0][0])
        except Exception as e:
            print(f'   {company} pre-2009 extract failed: {e}')
        shares = pre + shares
        rows = build_series(company, ticker, prices, shares)
        if not rows:
            print(f'!! {company} ({ticker}) no overlapping data, skip')
            continue
        first, last = min(rows, key=lambda r: r['date']), max(rows, key=lambda r: r['date'])
        since = dt.date.fromtimestamp(first['date']).year
        print(f'{company:18s} {ticker:5s} [{concept:14s}] '
              f'{len(rows):3d} mo since {since}{"*" if pre else " "} '
              f'latest ${last["marketcap"] / 1e12:.2f}T')
        all_rows += rows
    all_rows += spacex_rows()
    write_rows(all_rows)


if __name__ == '__main__':
    main()
