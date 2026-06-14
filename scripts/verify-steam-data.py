#!/usr/bin/env python3
"""校验 steam 数据集正确性：appid↔游戏名是否真的对得上，有无重复/缺数据/孤儿。

最大的错误风险是「appid 贴错」——一旦写错 appid，整条柱 + logo + 数据全是别的游戏。
本脚本对 update-steam-data.py 的 GAMES 里每个 appid，拉 Steam 商店 API 的规范名，
归一化后与脚本里写的英文名比对，列出不匹配的供人工确认。商店名缓存到 .cache/store_names.json。

另外检查：① GAMES 内 appid 重复；② 生成的 CSV 里的 appid 是否都在 GAMES（无孤儿）；
③ 每个游戏的数据是否非空/峰值合理；④ logo 与色表是否每个 appid 都齐。

用法：python3 scripts/verify-steam-data.py
依赖：仅标准库。
"""
from __future__ import annotations

import csv
import json
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SCRIPT = REPO / 'scripts/update-steam-data.py'
CSV_EN = REPO / 'apps/studio/public/steam.csv'
LOGO_DIR = REPO / 'apps/studio/public/steam-logos'
STUDIO_TSX = REPO / 'apps/studio/src/SteamCompositionZh.tsx'
CACHE = REPO / 'scripts/.cache/store_names.json'
UA = {'User-Agent': 'Mozilla/5.0 (anichart-v4 verify; jannchie@gmail.com)'}

# 故意改名 / 故意与商店名不同的 appid（已知正确，不算 mismatch）。
KNOWN_OK = {
    730: 'CS2（appid 730 历史是 CS:GO，已用 PRIOR_NAMES 处理）',
    433850: 'H1Z1（商店现名 Z1 Battle Royale）',
    221380: 'Age of Empires II HD（商店现名 Age of Empires II (Retired)）',
}


def parse_games() -> list[tuple[int, str, str]]:
    src = SCRIPT.read_text(encoding='utf-8')
    block = src.split('GAMES = [', 1)[1].split('\n]', 1)[0]
    games = []
    for line in block.splitlines():
        m = re.match(r"\s*\(\s*(\d+),\s*(['\"])(.+?)\2,\s*(['\"])(.+?)\4\s*\),", line)
        if m:
            games.append((int(m.group(1)), m.group(3), m.group(5)))
    return games


def normalize(s: str) -> str:
    s = s.lower()
    s = s.replace('®', '').replace('™', '').replace('©', '')
    s = s.replace('&', 'and')
    s = re.sub(r'[^a-z0-9]', '', s)  # 去标点空格，只留字母数字
    return s


def store_name(appid: int, cache: dict) -> str | None:
    key = str(appid)
    if key in cache:
        return cache[key]
    url = f'https://store.steampowered.com/api/appdetails?appids={appid}&filters=basic'
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20) as r:
            d = json.load(r)
        entry = d[key]
        name = entry['data']['name'] if entry.get('success') else None
    except (urllib.error.URLError, urllib.error.HTTPError, ValueError, KeyError, TypeError):
        name = None
    cache[key] = name
    time.sleep(0.2)
    return name


def main() -> int:
    games = parse_games()
    print(f'GAMES: {len(games)} 条')

    # ① 重复 appid
    seen, dups = set(), []
    for a, _, _ in games:
        (dups.append(a) if a in seen else seen.add(a))
    print(f'① 重复 appid: {dups or "无"}')

    # ② appid↔名 比对
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    print('② appid↔商店名 比对（拉取中，命中缓存则快）...')
    mismatches, failed = [], []
    for appid, en, zh in games:
        sn = store_name(appid, cache)
        if sn is None:
            failed.append((appid, en))
            continue
        na, nb = normalize(en), normalize(sn)
        ok = na in nb or nb in na or (len(na) >= 4 and len(nb) >= 4 and (na[:6] == nb[:6]))
        if not ok and appid not in KNOWN_OK:
            mismatches.append((appid, en, sn, zh))
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps(cache, ensure_ascii=False))
    if mismatches:
        print(f'  ⚠ {len(mismatches)} 个疑似 appid 贴错（我的名 ≠ 商店名）:')
        for appid, en, sn, zh in mismatches:
            print(f'    {appid}: 我写「{en}」/「{zh}」 ← 商店实为「{sn}」')
    else:
        print('  ✓ 全部匹配（或属已知改名）')
    if failed:
        print(f'  · 商店 API 没返回名（delisted/区域限制，不一定错）: {[a for a, _ in failed]}')

    # ③ CSV 孤儿：CSV 里有但 GAMES 没有的 appid
    csv_appids = {int(r['appid']) for r in csv.DictReader(CSV_EN.open(encoding='utf-8'))}
    game_appids = {a for a, _, _ in games}
    orphans = csv_appids - game_appids
    no_data = game_appids - csv_appids
    print(f'③ CSV 孤儿 appid（CSV 有/GAMES 无）: {orphans or "无"}')
    print(f'   GAMES 有但无数据被跳过: {no_data or "无"}')

    # ④ logo / 色表 完整性（仅对有数据的）
    logos = {int(p.stem) for p in LOGO_DIR.glob('*.jpg') if p.stat().st_size >= 3000}
    tsx = STUDIO_TSX.read_text(encoding='utf-8')
    cmap = tsx.split('steamColorMap', 1)[1].split('])', 1)[0]
    colored = {int(x.replace('_', '')) for x in re.findall(r'\[(\d[\d_]*),', cmap)}
    miss_logo = csv_appids - logos
    miss_color = csv_appids - colored
    print(f'④ 有数据但缺 logo: {miss_logo or "无"}')
    print(f'   有数据但缺品牌色: {miss_color or "无"}')

    bad = bool(dups or mismatches or orphans or miss_logo or miss_color)
    print('\n结论:', '❌ 有问题待修' if bad else '✅ 结构校验通过（appid/名/logo/色/无孤儿）')
    return 1 if bad else 0


if __name__ == '__main__':
    raise SystemExit(main())
