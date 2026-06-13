#!/usr/bin/env python3
"""用 Artificial Analysis 数据生成「按公司能力前沿」的 bar chart race（llm-aa.csv）。

与 LMArena 系列（update-llm-data.py）的根本区别：AA 没有「分数随时间演化」的序列，
只有每个模型一个当前 Intelligence Index（v4 统一口径重测）+ 一个 release_date。所以
这里按公司做 running-max——时间轴 = 模型发布日，公司柱值 = 该公司截至当前已发布模型里
的最高 II 分。公司每发一个更强的新模型，柱子就跳涨一档，换位动态由此而来。

口径说明（要诚实标注）：II 分是「今天的尺子」回测各模型、按发布日还原能力前沿推进，
不是「当时的分」。好处是所有模型同口径严格可比；代价是早期模型用的也是 v4 重测分。
数据来源需署名 Artificial Analysis（https://artificialanalysis.ai）。

输出列：company,model,rating,date（date 为 Unix 秒；company 为展示名，也是配色/logo key）。

用法：
  AA_API_KEY=xxx python3 scripts/update-aa-data.py

依赖：仅标准库。复用 update-llm-data.py 的 resolve_org / write_rows / PLAYGROUND。
"""
from __future__ import annotations

import collections
import datetime as dt
import importlib.util
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

# update-llm-data.py 文件名带连字符，不能直接 import；用 importlib 加载。
# 该模块顶层只有定义与常量（main 受 __name__ 保护，pyarrow 也是函数内 lazy import），
# 加载无副作用，复用它的归一化表与 CSV/路径，避免重复维护 ORG_DISPLAY 这种大字典。
_spec = importlib.util.spec_from_file_location(
    'update_llm_data', Path(__file__).with_name('update-llm-data.py'))
assert _spec and _spec.loader
_llm = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_llm)
resolve_org, write_rows, PLAYGROUND = _llm.resolve_org, _llm.write_rows, _llm.PLAYGROUND

API_URL = 'https://artificialanalysis.ai/api/v2/language/models/free'
OUTPUT = PLAYGROUND / 'llm-aa.csv'

# AA 的 model_creator.name → 现有展示名（logo/配色 key）。只列 update-llm-data.py 的
# ORG_DISPLAY 还覆盖不到的：那张表已认得 'Mistral'/'Perplexity' 等，这里补 AA 独有写法。
# 未列出的新公司原样保留（暂无 logo/配色，bar 会回退显示公司名）。
AA_ORG = {
    'Z AI': 'Z.ai',              # 智谱（ORG_DISPLAY 用 zai/Z.ai，AA 写成带空格的 Z AI）
    'ByteDance Seed': 'ByteDance',
    'TII UAE': 'TII',
    'Kimi': 'Moonshot AI',       # Kimi 是 Moonshot 的产品线
    'Inception': 'Inception AI',
    'InclusionAI': 'Ant Group',  # 蚂蚁的开源团队（Ling/Ming 系列）
}


def norm_company(creator: str) -> str:
    return resolve_org(AA_ORG.get(creator, creator), '')


def clean_model(name: str) -> str:
    # 去掉所有括号注记（reasoning 配置 / 日期版本 / effort 档位等），得到干净模型名，
    # 如 "Claude 4.5 Sonnet (Reasoning)" → "Claude 4.5 Sonnet"。running-max 仍按分数取
    # 最强变体，所以同名合并无损（公司柱只关心当前最强模型的展示名）。
    return re.sub(r'\s*[(（][^)）]*[)）]', '', name).strip()


def fetch_models() -> list[dict]:
    key = os.environ.get('AA_API_KEY')
    if not key:
        sys.exit('需要 AA_API_KEY 环境变量（去 artificialanalysis.ai 注册免费 key）')
    out: list[dict] = []
    page = 1
    while True:
        req = urllib.request.Request(f'{API_URL}?page={page}', headers={'x-api-key': key})
        with urllib.request.urlopen(req) as resp:
            payload = json.load(resp)
        out += payload['data']
        if not payload.get('pagination', {}).get('has_more'):
            break
        page += 1
    return out


def build_rows(models: list[dict]) -> list[dict]:
    # 过滤出有 II 分 + release_date 的模型，归一化公司名、日期转 Unix 秒。
    items: list[dict] = []
    for m in models:
        ii = (m.get('evaluations') or {}).get('artificial_analysis_intelligence_index')
        rd = m.get('release_date')
        cr = (m.get('model_creator') or {}).get('name')
        if ii is None or not rd or not cr:
            continue
        ts = int(dt.datetime.strptime(rd, '%Y-%m-%d')
                 .replace(tzinfo=dt.timezone.utc).timestamp())
        items.append({'company': norm_company(cr), 'model': clean_model(m['name']),
                      'rating': float(ii), 'ts': ts})

    # 每家公司按发布时间排序，预计算 running-max 折线：(ts, 累计最高分, 当前最强模型)。
    by_company: dict[str, list[dict]] = collections.defaultdict(list)
    for x in items:
        by_company[x['company']].append(x)
    curves: dict[str, list[tuple[int, float, str]]] = {}
    for company, xs in by_company.items():
        xs.sort(key=lambda x: (x['ts'], -x['rating']))
        cur_max, cur_model, curve = None, None, []
        for x in xs:
            if cur_max is None or x['rating'] > cur_max:
                cur_max, cur_model = x['rating'], x['model']
            curve.append((x['ts'], cur_max, cur_model))
        curves[company] = curve

    # 展开成每帧每公司一行（与 LMArena llm.csv 同形态，不依赖渲染端 forward-fill）：
    # 对每个 distinct 发布日，输出每个「已出现」公司截至此刻的 running max。
    dates = sorted({x['ts'] for x in items})
    rows: list[dict] = []
    for ts in dates:
        for company, curve in curves.items():
            val = model = None
            for cts, cmax, cmodel in curve:
                if cts > ts:
                    break
                val, model = cmax, cmodel
            if val is None:
                continue  # 该公司此刻尚未发布任何模型
            rows.append({'company': company, 'model': model,
                         'rating': round(val, 1), 'date': ts})
    return rows


def main() -> None:
    if '--logos' in sys.argv:
        _llm.download_logos()  # 复用全局 LOGO_URLS，已存在的文件自动跳过
        return
    models = fetch_models()
    rows = build_rows(models)
    write_rows(rows, [OUTPUT])
    companies = sorted({r['company'] for r in rows})
    print(f'{len(companies)} 家公司，{len(rows)} 行；'
          f'时间跨度 {min(r["date"] for r in rows)}…{max(r["date"] for r in rows)}')


if __name__ == '__main__':
    main()
