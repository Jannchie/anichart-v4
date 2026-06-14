#!/usr/bin/env python3
"""生成「Steam 热门游戏同时在线人数」的 bar chart race（steam.csv / steam-zh.csv）。

数据来自 steamcharts.com 的 `app/<appid>/chart-data.json`：每个游戏一条 [[unix_ms, 平均在线], ...]
的历史曲线（早期月度、近期日度）。本脚本按自然月聚合（取该月均值），输出长格式月度采样。

「同时在线人数」= 平均并发在线玩家（steamcharts 主图口径），绝对量，from-zero 才诚实。
候选池是手工策展的主流游戏清单（GAMES）：覆盖 2012–今的高峰值/现象级游戏，长青（Dota2/CS）+
现象级（PUBG/糖豆人/帕鲁/黑神话）混编。race 只显示 topN，候选多但只有真进过前列的才会出现。
工具/挂机/刷量类（Wallpaper Engine / Banana / Bongo Cat …）一律不收。

CSV 列：game（显示名，中/英两版不同）, appid（稳定键：图表按它做身份/配色/商店图标），players（值），
date（Unix 秒，月 1 号）。游戏在它首次有数据前不出现（淡入）；steamcharts 没有该 appid 时跳过。

显示名可随时间变（PRIOR_NAMES）：图表 id 用 appid（稳定）、label 用 game 列，所以同一条柱能中途
原地改名。典型：appid 730 在 CS2 上线（2023-09）前是「反恐精英：全球攻势」、之后是「反恐精英 2」。

抓取结果按 appid 缓存到 scripts/.cache/steamcharts/<appid>.json，便于改名/译名时免重抓、断点续抓。

用法：
  python3 scripts/update-steam-data.py            # 缺失的才抓，命中缓存直接用
  python3 scripts/update-steam-data.py --refresh  # 忽略缓存，全部重抓

依赖：仅标准库。
"""
from __future__ import annotations

import csv
import io
import json
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT_EN = [REPO / 'apps/playground/public/steam.csv', REPO / 'apps/studio/public/steam.csv']
OUT_ZH = [REPO / 'apps/playground/public/steam-zh.csv', REPO / 'apps/studio/public/steam-zh.csv']
CACHE_DIR = REPO / 'scripts/.cache/steamcharts'

UA = {'User-Agent': 'Mozilla/5.0 (anichart-v4 steam dataset; jannchie@gmail.com)'}

# (appid, 英文名, 中文名)。appid 来自 SteamCharts 官方 top-100 实拉 + Steam 商店 API 核验，均真实。
# 中文名取官方/社区通行译名；无通行中文名的（Rust / VRChat / DayZ / Garry's Mod / BeamNG / Marathon /
# PEAK / Unturned / R.E.P.O. / ARC Raiders / Schedule I / EA Sports FC / NBA 2K / eFootball）保留英文。
GAMES = [
    # ── 长青 / 元老 ──
    (570, 'Dota 2', 'Dota 2'),
    (730, 'Counter-Strike 2', '反恐精英 2'),
    (10, 'Counter-Strike', '反恐精英'),
    (240, 'Counter-Strike: Source', '反恐精英：起源'),
    (440, 'Team Fortress 2', '军团要塞 2'),
    (550, 'Left 4 Dead 2', '求生之路 2'),
    (4000, "Garry's Mod", "Garry's Mod"),
    (271590, 'Grand Theft Auto V', '侠盗猎车手 5'),
    # ── 大逃杀 / 射击 ──
    (578080, 'PUBG: BATTLEGROUNDS', '绝地求生'),
    (1172470, 'Apex Legends', 'Apex 英雄'),
    (1085660, 'Destiny 2', '命运 2'),
    (230410, 'Warframe', '星际战甲'),
    (1938090, 'Call of Duty', '使命召唤'),
    (2357570, 'Overwatch 2', '守望先锋 2'),
    (359550, 'Tom Clancy\'s Rainbow Six Siege', '彩虹六号：围攻'),
    (2507950, 'Delta Force', '三角洲行动'),
    (2807960, 'Battlefield 6', '战地 6'),
    (1517290, 'Battlefield 2042', '战地 2042'),
    (252490, 'Rust', 'Rust'),
    (221100, 'DayZ', 'DayZ'),
    (3932890, 'Escape from Tarkov', '逃离塔科夫'),
    (594650, 'Hunt: Showdown 1896', '猎杀：对决 1896'),
    (2073620, 'Arena Breakout: Infinite', '暗区突围：无限'),
    (553850, 'Helldivers 2', '绝地潜兵 2'),
    (1808500, 'ARC Raiders', 'ARC Raiders'),
    (3065800, 'Marathon', 'Marathon'),
    (2074920, 'The First Descendant', '第一后裔'),
    # ── MOBA / 竞技 ──
    (1422450, 'Deadlock', '死锁'),
    (2767030, 'Marvel Rivals', '漫威争锋'),
    (252950, 'Rocket League', '火箭联盟'),
    (1364780, 'Street Fighter 6', '街头霸王 6'),
    # ── ARPG / 魂 / 动作 ──
    (1245620, 'Elden Ring', '艾尔登法环'),
    (2622380, 'Elden Ring Nightreign', '艾尔登法环：黑夜君临'),
    (2358720, 'Black Myth: Wukong', '黑神话：悟空'),
    (1203220, 'NARAKA: BLADEPOINT', '永劫无间'),
    (2694490, 'Path of Exile 2', '流放之路 2'),
    (1599340, 'Lost Ark', '失落的方舟'),
    (1145360, 'Hades', '哈迪斯'),
    (582010, 'Monster Hunter: World', '怪物猎人：世界'),
    (1446780, 'Monster Hunter Rise', '怪物猎人：崛起'),
    (2246340, 'Monster Hunter Wilds', '怪物猎人：荒野'),
    (2050650, 'Resident Evil 4', '生化危机 4'),
    (1174180, 'Red Dead Redemption 2', '荒野大镖客 2：救赎'),
    (1091500, 'Cyberpunk 2077', '赛博朋克 2077'),
    (990080, 'Hogwarts Legacy', '霍格沃茨之遗'),
    # ── 生存 / 建造 / 沙盒 ──
    (1623730, 'Palworld', '幻兽帕鲁'),
    (105600, 'Terraria', '泰拉瑞亚'),
    (346110, 'ARK: Survival Evolved', '方舟：生存进化'),
    (2399830, 'ARK: Survival Ascended', '方舟：生存飞升'),
    (892970, 'Valheim', '英灵神殿'),
    (1203620, 'Enshrouded', '笼罩'),
    (1326470, 'Sons of the Forest', '森林之子'),
    (251570, '7 Days to Die', '七日杀'),
    (108600, 'Project Zomboid', '僵尸毁灭工程'),
    (2139460, 'Once Human', '七日世界'),
    (548430, 'Deep Rock Galactic', '深岩银河'),
    (275850, "No Man's Sky", '无人深空'),
    (1962700, 'Subnautica 2', '深海迷航 2'),
    (322330, "Don't Starve Together", '饥荒：联机版'),
    (526870, 'Satisfactory', '幸福工厂'),
    (427520, 'Factorio', '异星工厂'),
    (457140, 'Oxygen Not Included', '缺氧'),
    (304930, 'Unturned', 'Unturned'),
    # ── 社交 / 派对 / 恐怖 ──
    (945360, 'Among Us', '太空狼人杀'),
    (1568590, 'Goose Goose Duck', '鹅鸭杀'),
    (1599600, 'PlateUp!', 'PlateUp!'),
    (1097150, 'Fall Guys', '糖豆人'),
    (381210, 'Dead by Daylight', '黎明杀机'),
    (739630, 'Phasmophobia', '恐鬼症'),
    (1966720, 'Lethal Company', '致命公司'),
    (3527290, 'PEAK', 'PEAK'),
    (1943950, 'Escape the Backrooms', '逃离后室'),
    (3241660, 'R.E.P.O.', 'R.E.P.O.'),
    (438100, 'VRChat', 'VRChat'),
    (1426210, 'It Takes Two', '双人成行'),
    # ── 策略 / 模拟 / 经营 ──
    (289070, 'Civilization VI', '文明 6'),
    (394360, 'Hearts of Iron IV', '钢铁雄心 4'),
    (1158310, 'Crusader Kings III', '十字军之王 3'),
    (1142710, 'Total War: Warhammer III', '全面战争：战锤 3'),
    (2183900, 'Warhammer 40,000: Space Marine 2', '战锤 40K：星际战士 2'),
    (261550, 'Mount & Blade II: Bannerlord', '骑马与砍杀 2：霸主'),
    (813780, 'Age of Empires II: Definitive Edition', '帝国时代 2：决定版'),
    (294100, 'RimWorld', '边缘世界'),
    (1363080, 'Manor Lords', '庄园领主'),
    (1222670, 'The Sims 4', '模拟人生 4'),
    (2300320, 'Farming Simulator 25', '模拟农场 25'),
    # ── Roguelike / 独立 ──
    (2379780, 'Balatro', '小丑牌'),
    (1794680, 'Vampire Survivors', '吸血鬼幸存者'),
    (250900, 'The Binding of Isaac: Rebirth', '以撒的结合：重生'),
    (2868840, 'Slay the Spire 2', '杀戮尖塔 2'),
    (3164500, 'Schedule I', 'Schedule I'),
    (322170, 'Geometry Dash', '几何冲刺'),
    (284160, 'BeamNG.drive', 'BeamNG.drive'),
    # ── 竞速 / 体育 ──
    (1551360, 'Forza Horizon 5', '极限竞速：地平线 5'),
    (2483190, 'Forza Horizon 6', '极限竞速：地平线 6'),
    (3405690, 'EA Sports FC 26', 'EA Sports FC 26'),
    (3472040, 'NBA 2K26', 'NBA 2K26'),
    (3551340, 'Football Manager 26', '足球经理 26'),
    (1665460, 'eFootball', 'eFootball'),
    # ── MMO / 网游 / 国产 ──
    (39210, 'Final Fantasy XIV', '最终幻想 14'),
    (1063730, 'New World', '新世界'),
    (1172620, 'Sea of Thieves', '盗贼之海'),
    (582660, 'Black Desert', '黑色沙漠'),
    (3513350, 'Wuthering Waves', '鸣潮'),
    (3564740, 'Where Winds Meet', '燕云十六声'),
    (3321460, 'Crimson Desert', '红色沙漠'),
    (236390, 'War Thunder', '战争雷霆'),
    (218620, 'PAYDAY 2', '收获日 2'),
    (1449850, 'Yu-Gi-Oh! Master Duel', '游戏王：决斗大师'),
    (1086940, "Baldur's Gate 3", '博德之门 3'),
    (413150, 'Stardew Valley', '星露谷物语'),
    (489830, 'The Elder Scrolls V: Skyrim Special Edition', '上古卷轴 5：天际 特别版'),
    # ── 早期热门（2012–2018 当年峰值高、现已回落，多不在当前 top-100）──
    (8930, "Sid Meier's Civilization V", '文明 5'),
    (377160, 'Fallout 4', '辐射 4'),
    (292030, 'The Witcher 3: Wild Hunt', '巫师 3：狂猎'),
    (374320, 'Dark Souls III', '黑暗之魂 3'),
    (238960, 'Path of Exile', '流放之路'),
    (433850, 'H1Z1', 'H1Z1'),
    (107410, 'Arma 3', '武装突袭 3'),
    (72850, 'The Elder Scrolls V: Skyrim', '上古卷轴 5：天际'),
    (255710, 'Cities: Skylines', '城市：天际线'),
    (227300, 'Euro Truck Simulator 2', '欧洲卡车模拟 2'),
    (364360, 'Total War: Warhammer', '全面战争：战锤'),
    (214950, 'Total War: Rome II', '全面战争：罗马 2'),
    (49520, 'Borderlands 2', '无主之地 2'),
    (444090, 'Paladins', '圣金枪手'),
    (386360, 'SMITE', '神之浩劫'),
    (440900, 'Conan Exiles', '流放者柯南'),
    (365590, "Tom Clancy's The Division", '全境封锁'),
    (211820, 'Starbound', '星界边境'),
    (236850, 'Europa Universalis IV', '欧陆风云 4'),
    (203770, 'Crusader Kings II', '十字军之王 2'),
    (48700, 'Mount & Blade: Warband', '骑马与砍杀：战团'),
    (359320, 'Elite Dangerous', '精英：危险'),
    (268500, 'XCOM 2', '幽浮 2'),
    # ── 2012–2014 当年中量级热门（早期榜位空，填进来更真实；SteamCharts 始于 2012-07）──
    (218230, 'PlanetSide 2', '行星边际 2'),
    (202970, 'Call of Duty: Black Ops II', '使命召唤：黑色行动 2'),
    (221380, 'Age of Empires II HD', '帝国时代 2 HD'),
    (219640, 'Chivalry: Medieval Warfare', '骑士精神：中世纪战争'),
    (200710, 'Torchlight II', '火炬之光 2'),
    (1250, 'Killing Floor', '杀戮空间'),
    (232090, 'Killing Floor 2', '杀戮空间 2'),
    (200510, 'XCOM: Enemy Unknown', '幽浮：未知敌人'),
    (219740, "Don't Starve", '饥荒'),
    (113200, 'The Binding of Isaac', '以撒的结合'),
    (4920, 'Natural Selection 2', '自然选择 2'),
    (65800, 'Dungeon Defenders', '地牢守护者'),
    (55230, 'Saints Row: The Third', '黑道圣徒 3'),
    (34330, 'Total War: Shogun 2', '全面战争：幕府将军 2'),
    (222880, 'Insurgency', '叛乱'),
    (8500, 'EVE Online', 'EVE Online'),
    (17080, 'Tribes: Ascend', 'Tribes: Ascend'),
    (200210, 'Realm of the Mad God', 'Realm of the Mad God'),
    (204300, 'Awesomenauts', 'Awesomenauts'),
    (99900, 'Spiral Knights', 'Spiral Knights'),
    # ── 大批量查漏：各年代高峰值但前面漏掉的（F2P 射击 / 大作 / 病毒式爆款 / 策略大作）──
    (1240440, 'Halo Infinite', '光环：无限'),
    (2073850, 'THE FINALS', 'THE FINALS'),
    (976730, 'Halo: The Master Chief Collection', '光环：士官长合集'),
    (1238810, 'Battlefield V', '战地 5'),
    (1238840, 'Battlefield 1', '战地 1'),
    (686810, 'Hell Let Loose', '人间地狱'),
    (393380, 'Squad', 'Squad'),
    (581320, 'Insurgency: Sandstorm', '叛乱：沙漠风暴'),
    (1144200, 'Ready or Not', '严阵以待'),
    (291550, 'Brawlhalla', '英灵乱斗'),
    (1778820, 'Tekken 8', '铁拳 8'),
    (2344520, 'Diablo IV', '暗黑破坏神 4'),
    (899770, 'Last Epoch', '最后纪元'),
    (632360, 'Risk of Rain 2', '雨中冒险 2'),
    (306130, 'The Elder Scrolls Online', '上古卷轴 OL'),
    (2054970, "Dragon's Dogma 2", '龙之信条 2'),
    (1771300, 'Kingdom Come: Deliverance II', '天国：拯救 2'),
    (1145350, 'Hades II', '哈迪斯 2'),
    (588650, 'Dead Cells', '死亡细胞'),
    (1604030, 'V Rising', '夜族崛起'),
    (648800, 'Raft', '木筏求生'),
    (242760, 'The Forest', '森林'),
    (264710, 'Subnautica', '深海迷航'),
    (962130, 'Grounded', '禁闭求生'),
    (1621690, 'Core Keeper', '核心守护者'),
    (1782210, 'Crab Game', '螃蟹游戏'),
    (2881650, 'Content Warning', 'Content Warning'),
    (2670630, 'Supermarket Simulator', '超市模拟器'),
    (281990, 'Stellaris', '群星'),
    (779340, 'Total War: Three Kingdoms', '全面战争：三国'),
    (1934680, 'Age of Mythology: Retold', '神话时代：重述'),
    (1677280, 'Company of Heroes 3', '英雄连 3'),
    (949230, 'Cities: Skylines II', '城市：天际线 2'),
    (270880, 'American Truck Simulator', '美国卡车模拟'),
    # ── 末轮查漏：2022–2025 高峰值（>7 万，必进 top-18）──
    (2429640, 'Throne and Liberty', 'Throne and Liberty'),
    (2001120, 'Split Fiction', '双影奇境'),
    (1903340, 'Clair Obscur: Expedition 33', '光与影：33号远征队'),
    (1282100, 'Remnant II', '遗迹 2'),
    (1361210, 'Warhammer 40,000: Darktide', '战锤 40K：暗潮'),
    (1623660, 'MIR4', '传奇 4'),
    (1295660, 'Civilization VII', '文明 7'),
    (2456740, 'inZOI', 'inZOI'),
    (2479810, 'Gray Zone Warfare', 'Gray Zone Warfare'),
    # ── 中段年代（2018–2022）查漏：50k–150k 峰值 ──
    (1818750, 'MultiVersus', 'MultiVersus'),
    (424370, 'Wolcen: Lords of Mayhem', 'Wolcen'),
    (680420, 'Outriders', 'Outriders'),
    (552500, 'Warhammer: Vermintide 2', '战锤：末世鼠疫 2'),
    (1466860, 'Age of Empires IV', '帝国时代 4'),
    (677620, 'Splitgate', 'Splitgate'),
    (629760, 'Mordhau', 'Mordhau'),
    (646570, 'Slay the Spire', '杀戮尖塔'),
    (323190, 'Frostpunk', '冰汽时代'),
]

# 同一 appid 的历史显示名（在 GAMES 当前名之前用过的旧名）。结构：appid -> [(until_ym, en, zh), ...]，
# 月份 < until_ym（字符串比较，YYYY-MM）时用旧名，否则用 GAMES 里的当前名。
PRIOR_NAMES: dict[int, list[tuple[str, str, str]]] = {
    # CS2 于 2023-09-27 原地替换 CS:GO（同 appid 730）。之前的数据其实是 CS:GO。
    730: [('2023-09', 'Counter-Strike: Global Offensive', '反恐精英：全球攻势')],
}


def name_for(appid: int, ym: str, lang: int, default: str) -> str:
    """appid 在月份 ym 应显示的名字（lang: 1=en, 2=zh）。无历史改名则返回 default（GAMES 当前名）。"""
    for until, en, zh in PRIOR_NAMES.get(appid, ()):
        if ym < until:
            return en if lang == 1 else zh
    return default


# 同一 appid 的历史 banner 图 key（当前默认图之前用过的旧图）。结构同 PRIOR_NAMES：appid -> [(until_ym, key), ...]，
# 月份 < until_ym 时用旧图 key，否则用默认 key（=str(appid)）。composition 的 image:'logo' 据此逐帧切 banner 并交叉淡入。
PRIOR_LOGOS: dict[int, list[tuple[str, str]]] = {
    # CS2 上线前（< 2023-09）用 CS:GO 旧封面 730-csgo.jpg。该图 Steam 已原地替换、CDN 不再提供，
    # 存档自 Wayback 手动留在 public/steam-logos/730-csgo.jpg；update-steam-logos.py 按 appid 抓图不会覆盖它。
    730: [('2023-09', '730-csgo')],
}


def logo_for(appid: int, ym: str) -> str:
    """appid 在月份 ym 应使用的 banner 图 key。无历史换图则返回 str(appid)。"""
    for until, key in PRIOR_LOGOS.get(appid, ()):
        if ym < until:
            return key
    return str(appid)


def fetch_monthly(appid: int, refresh: bool) -> dict[str, float]:
    """抓 steamcharts 历史曲线，按 'YYYY-MM' 聚合为该月均值。命中缓存则直接用。"""
    cache = CACHE_DIR / f'{appid}.json'
    if cache.exists() and not refresh:
        points = json.loads(cache.read_text())
    else:
        url = f'https://steamcharts.com/app/{appid}/chart-data.json'
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=30) as r:
            points = json.load(r)
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps(points))
        time.sleep(0.4)  # 仅真正联网时限流
    buckets: dict[str, list[float]] = defaultdict(list)
    for ts_ms, players in points:
        if players is None:
            continue
        ym = time.strftime('%Y-%m', time.gmtime(ts_ms / 1000))
        buckets[ym].append(float(players))
    return {ym: sum(v) / len(v) for ym, v in buckets.items()}


def month_range(months: list[str]) -> list[str]:
    lo, hi = min(months), max(months)
    y, m = int(lo[:4]), int(lo[5:7])
    hy, hm = int(hi[:4]), int(hi[5:7])
    out = []
    while (y, m) <= (hy, hm):
        out.append(f'{y:04d}-{m:02d}')
        y, m = (y, m + 1) if m < 12 else (y + 1, 1)
    return out


def ym_to_unix(ym: str) -> int:
    return int(time.mktime((int(ym[:4]), int(ym[5:7]), 1, 0, 0, 0, 0, 0, 0)) - time.timezone)


def build_rows(series: dict[int, dict[str, float]], name_idx: int) -> list[dict]:
    """series[appid][ym] -> 均值。每游戏从首个有数据的月发到最后有数据的月（中间空月补 0=淡出）。"""
    all_months = month_range([ym for s in series.values() for ym in s])
    default_name = {g[0]: str(g[name_idx]) for g in GAMES}
    rows: list[dict] = []
    for appid, s in series.items():
        active = [m for m in all_months if s.get(m, 0) > 0]
        if not active:
            continue
        lo, hi = all_months.index(active[0]), all_months.index(active[-1])
        for m in all_months[lo:hi + 1]:
            rows.append({'game': name_for(appid, m, name_idx, default_name[appid]), 'appid': appid,
                         'players': round(s.get(m, 0)), 'date': ym_to_unix(m), 'logo': logo_for(appid, m)})
    rows.sort(key=lambda r: (r['date'], r['appid']))
    return rows


def write_rows(rows: list[dict], outputs: list[Path]) -> None:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=['game', 'appid', 'players', 'date', 'logo'])
    w.writeheader()
    w.writerows(rows)
    data = buf.getvalue()
    for path in outputs:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(data, encoding='utf-8')
        print(f'  wrote {len(rows):,} rows -> {path}')


def main() -> None:
    refresh = '--refresh' in sys.argv[1:]
    series: dict[int, dict[str, float]] = {}
    for appid, en, _ in GAMES:
        try:
            monthly = fetch_monthly(appid, refresh)
            if not monthly:
                print(f'  {en:34s} EMPTY (无在线数据，跳过)', file=sys.stderr)
                continue
            series[appid] = monthly
            print(f'  {en:34s} {len(monthly):3d} months  (from {min(monthly)})', file=sys.stderr)
        except (urllib.error.URLError, urllib.error.HTTPError, ValueError) as e:
            print(f'  {en:34s} SKIP ({type(e).__name__})', file=sys.stderr)
    if not series:
        sys.exit('no data fetched')
    print(f'{len(series)}/{len(GAMES)} 个游戏有数据')
    print('English:')
    write_rows(build_rows(series, 1), OUT_EN)
    print('中文:')
    write_rows(build_rows(series, 2), OUT_ZH)


if __name__ == '__main__':
    main()
