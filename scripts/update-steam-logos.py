#!/usr/bin/env python3
"""下载 Steam 游戏横版 capsule（柱子右端的 banner logo），供 studio 的 SteamZh composition 使用。

每个 appid 从 Steam CDN 取 `capsule_231x87.jpg`（封面+标题的小横幅，231×87，无需 API key）：
  https://cdn.cloudflare.steamstatic.com/steam/apps/<appid>/capsule_231x87.jpg

appid 列表直接读 steam.csv（与 update-steam-data.py 输出的同一份键），避免两处清单漂移。
输出 apps/studio/public/steam-logos/<appid>.jpg；composition 里设 image:'appid' 后按 appid 取图。

用法：
  python3 scripts/update-steam-logos.py            # 下载所有缺失的；--force 覆盖已存在

依赖：仅标准库。
"""
from __future__ import annotations

import csv
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
STEAM_CSV = REPO / 'apps/studio/public/steam.csv'
OUT_DIR = REPO / 'apps/studio/public/steam-logos'

# 实测只有 cdn.cloudflare.steamstatic.com 这个 host 稳定回 200，shared.* / akamai.* 都 404。
# 多级回退：老游有 capsule_231x87，新游往往只有 header / capsule_616x353（图名随年代变）。
# 都是横版 banner，宽高比略有差异（2.66 / 2.14 / 1.74）但同为横幅，柱右端观感一致。
HOST = 'https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/{name}'
CAPSULE_NAMES = ['capsule_231x87.jpg', 'header.jpg', 'capsule_616x353.jpg']
MIN_BYTES = 3000  # 小于此视为占位/错误页（如 404 的 146B、coming-soon 的 ~1.4KB），不算命中
UA = {'User-Agent': 'Mozilla/5.0 (anichart-v4 steam logos; jannchie@gmail.com)'}


def unique_appids(csv_path: Path) -> list[str]:
    seen: dict[str, None] = {}
    with csv_path.open(encoding='utf-8') as f:
        for row in csv.DictReader(f):
            appid = (row.get('appid') or '').strip()
            if appid:
                seen.setdefault(appid, None)
    return list(seen)


def _get(url: str) -> bytes | None:
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as resp:
            return resp.read()
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError):
        return None


def store_header_url(appid: str) -> str | None:
    """新游（2024+）的横幅在带 hash 的 store_item_assets 路径下，固定 CDN 路径会 404。
    用商店 API 拿真实 header_image URL（含 hash + 时间戳）作最终回退。"""
    raw = _get(f'https://store.steampowered.com/api/appdetails?appids={appid}&filters=basic')
    if not raw:
        return None
    try:
        d = json.loads(raw)
        entry = d[str(appid)]
        return entry['data']['header_image'] if entry.get('success') else None
    except (json.JSONDecodeError, KeyError, TypeError):
        return None


def fetch(appid: str) -> tuple[bytes, str] | None:
    """按 CAPSULE_NAMES 顺序取第一张 ≥MIN_BYTES 的横幅；都没有再走商店 API header_image。返回 (bytes, 来源)。"""
    for name in CAPSULE_NAMES:
        data = _get(HOST.format(appid=appid, name=name))
        if data and len(data) >= MIN_BYTES:
            return data, name
    url = store_header_url(appid)
    if url:
        data = _get(url)
        if data and len(data) >= MIN_BYTES:
            return data, 'store_api'
    return None


def main() -> int:
    force = '--force' in sys.argv[1:]
    if not STEAM_CSV.exists():
        print(f'找不到 {STEAM_CSV}，先跑 update-steam-data.py', file=sys.stderr)
        return 1
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    appids = unique_appids(STEAM_CSV)
    print(f'{len(appids)} 个 appid，输出到 {OUT_DIR}')

    ok = skipped = failed = 0
    missing: list[str] = []
    for appid in appids:
        dst = OUT_DIR / f'{appid}.jpg'
        # 已有且不是占位/过小文件才跳过；过小的（旧版本残留）重抓。
        if dst.exists() and dst.stat().st_size >= MIN_BYTES and not force:
            skipped += 1
            continue
        got = fetch(appid)
        if got is None:
            print(f'  ✗ {appid}: 无可用横幅（capsule/header 都缺）', file=sys.stderr)
            dst.unlink(missing_ok=True)  # 清掉可能残留的占位小文件
            failed += 1
            missing.append(appid)
            continue
        data, used = got
        dst.write_bytes(data)
        ok += 1
        print(f'  ✓ {appid} ({len(data) // 1024}KB, {used})')
        time.sleep(0.3)  # 限流：CDN 对快速连发会返 0/限速

    print(f'完成：新下载 {ok}，已存在跳过 {skipped}，失败 {failed}')
    if missing:
        print(f'缺图 appid: {" ".join(missing)}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
