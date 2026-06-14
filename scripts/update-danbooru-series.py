#!/usr/bin/env python3
r"""生成「Danbooru 各 series（版权作品）累计投稿数」的 bar chart race。

一次扫描 → 缓存月度计数 → 同时产出中英两份 CSV（danbooru-series.csv / danbooru-series-zh.csv）。

数据源是本地 Danbooru 元数据 SQLite（posts 表，约 1100 万条）。一个 series = Danbooru 的
copyright 标签（tag_string_copyright，空格分隔）。「投稿数」= 该 series 出现在多少张 post 上，
按 post 的 created_at 月份累计。

同系列合并（关键）：Danbooru 把一个大系列拆成很多子标签（fate/grand_order、fate/stay_night、
fate_(series)…；idolmaster_cinderella_girls…；pokemon_sv…），且有 tag implication，一稿常同时
带「子标签 + 系列伞标签」。所以：
  · 用前缀规则把子标签归并到规范系列键（见 FRANCHISES，group_of()）。
  · 计数按「每稿对每个系列至多计一次」去重——直接把子标签计数相加会把同时带多个子标签的稿件重复计。
未列入 FRANCHISES 的标签各自独立成组（组键 = 标签本身）。

为什么用累计（cumulative）：bar chart race 表达「存量随时间此消彼长」，和仓库里 stocks/gdp/llm 一样
是 level-over-time，累计柱单调增长、排名随热度迁移最耐看。

同时再出一个「增速榜」（danbooru-series-growth*.csv）：value = 滚动 TRAILING_WINDOW 个月新增和
（默认 12=近一年滚动，最耐看；按月窗太抖故弃用）。能看谁正当红、死掉的系列会自然淡出。两个榜各出
中英两版，一次 --from-cache 全产出。

CSV 列：series（显示名，中/英两版不同）, tag（规范系列键，两版一致，datasets.ts 按它查主题色）,
count（值）, date（Unix 秒，月 1 号）。

口径与取舍：
  · 默认排除 `original`（原创/无版权标记，量级碾压）。
  · 只取合并后总量 top-N（默认 60）个系列。选取用频率表近似排序，真实值来自去重扫描。
  · 中文名：FRANCHISES 里写死规范译名；独立标签取 copyright_name_map.json 的 zh_hans→zh_hant，
    缺失回退 ZH_OVERRIDES→英文。
  · 月度采样：某月 value = 截至该月末的累计投稿数，时间戳记为该月 1 号；系列首投前不出现（淡入）。

全表扫描 47GB（无覆盖索引），WSL /mnt 上 ~5–10k rows/s。扫一次把月度计数缓存到
scripts/data/danbooru-series-monthly.json；之后只调显示名/语言用 --from-cache 秒级重生成
（注意：改 FRANCHISES 分组会影响计数，必须重扫，不能用缓存）。

用法：
  python3 scripts/update-danbooru-series.py                 # 全表扫描 + 写缓存 + 中英两份 CSV
  python3 scripts/update-danbooru-series.py --from-cache    # 跳过扫描，从缓存重生成（仅改显示名时）
  python3 scripts/update-danbooru-series.py --limit 500000  # 小样验证管线

WSL 空间不足、库在 Windows 盘（E:）时：把重扫放宿主机原生跑，只回传几百 KB 缓存——
  # ① WSL 里把脚本拷到 Windows 侧（避免 UNC/CWD 问题）
  cp scripts/update-danbooru-series.py /mnt/e/danbooru_metadata/_scan.py
  # ② 用 Windows Python 原生扫描（比 WSL 读 /mnt 的 9p 快 3–4×），只导缓存
  python.exe 'E:\danbooru_metadata\_scan.py' --scan-only \
    --database 'E:\danbooru_metadata\data\db\danbooru_metadata.db' \
    --freq-csv 'E:\danbooru_metadata\data\outputs\tags\tag_frequency_copyright.csv' \
    --cache 'E:\danbooru_metadata\series_cache.json'
  # ③ 回 WSL：缓存就位 + 出 CSV（小而快）
  cp /mnt/e/danbooru_metadata/series_cache.json scripts/data/danbooru-series-monthly.json
  python3 scripts/update-danbooru-series.py --from-cache

依赖：仅标准库。
"""
from __future__ import annotations

import argparse
import calendar
import csv
import io
import json
import re
import sqlite3
import sys
import time
from collections import defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DB_PATH = Path('/mnt/e/danbooru_metadata/data/db/danbooru_metadata.db')
DATA = Path('/mnt/e/danbooru_metadata/data/outputs')

# 增速榜：value = 滚动 TRAILING_WINDOW 个月的新增和。1=当月新增（最跟手）；12=近一年滚动（最平滑）。
# 实践下来按月窗太抖、季节噪声大，按年（12 月）窗最耐看，故定为 12。
TRAILING_WINDOW = 12

# 各 tag 维度共用同一套扫描/缓存/出图，只是扫不同列、用不同频率表/译名表/输出名：
#   copyright（作品）—— 合并同系列（FRANCHISES），排除原创/伞标签/VTuber 泛类。
#   character（角色）—— 不合并（角色变体量少，主标签已占绝大多数），无排除。
# original / honkai_(series)：见 BLOCKLIST 注释（伞标签与具体作品重复，故排除）。
FIELDS = {
    'copyright': dict(
        column='tag_string_copyright',
        freq=DATA / 'tags/tag_frequency_copyright.csv',
        name_map=DATA / 'translations/copyright_name_map.json',
        out='danbooru-series', merge=True,
        blocklist={'original', 'honkai_(series)', 'indie_virtual_youtuber'},
    ),
    'character': dict(
        column='tag_string_character',
        freq=DATA / 'tags/tag_frequency_character.csv',
        name_map=DATA / 'translations/character_name_map.json',
        out='danbooru-character', merge=False,
        # 同一角色被拆成主标签 + 别名/子形态标签（且 name_map 常给同名）→ 折叠掉次要 tag，
        # 只留规范主 tag 一条。不相加（半灵几乎总与妖梦共现、saber 与 artoria 大量共现，相加会重复计）。
        #   saber_(fate)          ⊂ artoria_pendragon_(fate)（同为阿尔托莉雅，zh 同名）
        #   konpaku_youmu_(ghost) ⊂ konpaku_youmu（妖梦的半灵，en 同名 Konpaku Youmu）
        blocklist={'saber_(fate)', 'konpaku_youmu_(ghost)'},
    ),
}

# 运行时由 --field 填入（group_of / select_groups / scan 读取）。
_COLUMN = 'tag_string_copyright'
_MERGE = True
_BLOCKLIST: set[str] = set()


def out_paths(base: str) -> dict[str, list[Path]]:
    pub = ('apps/playground/public', 'apps/studio/public')
    return {k: [REPO / d / f'{base}{sfx}.csv' for d in pub] for k, sfx in
            (('en', ''), ('zh', '-zh'), ('gen', '-growth'), ('gzh', '-growth-zh'))}

# 同系列合并规则：(规范键, 英文名, 中文名, [标签前缀...])。
# group_of(tag)：命中任一前缀 → 规范键；否则标签独立成组。前缀都挑过、不会误伤其它系列。
FRANCHISES = [
    ('touhou', 'Touhou Project', '东方Project', ['touhou']),
    ('fate', 'Fate', 'Fate', ['fate/', 'fate_(']),
    ('idolmaster', 'THE iDOLM@STER', '偶像大师', ['idolmaster', 'gakuen_idolmaster']),
    ('love_live', 'Love Live!', 'Love Live!', ['love_live', 'link!_like!_love_live']),
    ('pokemon', 'Pokémon', '宝可梦', ['pokemon']),
    ('final_fantasy', 'Final Fantasy', '最终幻想', ['final_fantasy']),
    ('fire_emblem', 'Fire Emblem', '火焰纹章', ['fire_emblem']),
    ('honkai_star_rail', 'Honkai: Star Rail', '崩坏：星穹铁道', ['honkai:_star_rail', 'honkai_star_rail']),
    ('honkai_impact_3rd', 'Honkai Impact 3rd', '崩坏3', ['honkai_impact_3rd', 'honkai_impact']),
    ('bang_dream', 'BanG Dream!', 'BanG Dream!', ['bang_dream']),
    ('gundam', 'Gundam', '高达', ['gundam']),
    ('persona', 'Persona', '女神异闻录', ['persona']),
    ('umamusume', 'Umamusume', '赛马娘', ['umamusume']),
    ('sword_art_online', 'Sword Art Online', '刀剑神域', ['sword_art_online']),
    ('madoka', 'Puella Magi Madoka Magica', '魔法少女小圆', ['mahou_shoujo_madoka_magica']),
    ('granblue_fantasy', 'Granblue Fantasy', '碧蓝幻想', ['granblue']),
    ('danganronpa', 'Danganronpa', '弹丸论破', ['danganronpa']),
    ('jojo', "JoJo's Bizarre Adventure", 'JOJO的奇妙冒险', ['jojo_no_kimyou_na_bouken']),
    ('precure', 'Pretty Cure', '光之美少女', ['precure']),
    ('hololive', 'hololive', 'hololive', ['hololive']),
    ('nijisanji', 'Nijisanji', '彩虹社', ['nijisanji']),
    ('zelda', 'The Legend of Zelda', '塞尔达传说', ['the_legend_of_zelda']),
    ('kantai_collection', 'Kantai Collection', '舰队Collection', ['kantai_collection']),
    ('project_moon', 'Project Moon', 'Project Moon', ['project_moon', 'limbus_company',
                                                      'lobotomy_corporation', 'library_of_ruina']),
    ('xenoblade', 'Xenoblade Chronicles', '异度神剑', ['xenoblade']),
    ('world_witches', 'World Witches', '强袭魔女', ['world_witches', 'strike_witches']),
    ('lyrical_nanoha', 'Magical Girl Lyrical Nanoha', '魔法少女奈叶',
     ['lyrical_nanoha', 'mahou_shoujo_lyrical_nanoha']),
    ('haruhi', 'The Melancholy of Haruhi Suzumiya', '凉宫春日的忧郁', ['suzumiya_haruhi']),
    ('naruto', 'Naruto', '火影忍者', ['naruto']),
]
FRANCHISE_PREFIXES = [(pfx, key) for key, _, _, pfxs in FRANCHISES for pfx in pfxs]
FRANCHISE_EN = {key: en for key, en, _, _ in FRANCHISES}
FRANCHISE_ZH = {key: zh for key, _, zh, _ in FRANCHISES}

# 显示名中文兜底（按 tag 查，作品 / 角色通用，键互不冲突）：name_map 缺 zh，或俗称比官方译名通行的。
ZH_OVERRIDES = {
    # 作品
    'kemono_friends': '兽娘动物园',
    'goddess_of_victory:_nikke': '胜利女神：NIKKE',
    'league_of_legends': '英雄联盟',
    'mario_(series)': '超级马里奥',
    'street_fighter': '街头霸王',
    'dragon_ball': '龙珠',  # 大陆官方译名（台译「七龙珠」）
    # 角色（character_name_map 缺 zh）
    'komeiji_satori': '古明地觉',
    'doodle_sensei_(blue_archive)': '涂鸦先生',
}

# 独立标签的英文兜底：name_map 的 en 缺失或不够地道时覆盖。
EN_OVERRIDES = {
    'k-on!': 'K-On!',
    'toaru_majutsu_no_index': 'A Certain Magical Index',
    'mario_(series)': 'Super Mario',
    'sousou_no_frieren': "Frieren: Beyond Journey's End",
    'splatoon_(series)': 'Splatoon',
    'bocchi_the_rock!': 'Bocchi the Rock!',
}

YM_RE = re.compile(r'^\d{4}-\d{2}')
# 去掉显示名末尾的「(系列)」「(anime)」「（系列）」等括号后缀：name_map 派生名常带 Danbooru 标签
# 的消歧后缀，作品名里不该出现。只清理 name_map / prettify 的兜底名，手写的 FRANCHISES/OVERRIDES 不动。
PAREN_SUFFIX_RE = re.compile(r'\s*[\(（][^)）]*[\)）]\s*$')
_gcache: dict[str, str] = {}


def strip_paren(name: str) -> str:
    cleaned = PAREN_SUFFIX_RE.sub('', name).strip()
    return cleaned or name


def group_of(tag: str) -> str:
    """标签 → 规范键（copyright 命中 FRANCHISES 前缀则归并；其它维度不合并，标签即键）。带缓存。"""
    if not _MERGE:
        return tag
    g = _gcache.get(tag)
    if g is None:
        g = tag
        for pfx, key in FRANCHISE_PREFIXES:
            if tag.startswith(pfx):
                g = key
                break
        _gcache[tag] = g
    return g


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--field', choices=tuple(FIELDS), default='copyright', help='扫哪个维度：作品 / 角色')
    p.add_argument('--database', type=Path, default=DB_PATH)
    p.add_argument('--freq-csv', type=Path, default=None, help='默认按 --field 取对应频率表')
    p.add_argument('--name-map', type=Path, default=None, help='默认按 --field 取对应译名表')
    p.add_argument('--top-n', type=int, default=60, help='纳入的系列数（合并后，按近似总量）')
    p.add_argument('--from-cache', action='store_true', help='跳过扫描，从缓存重生成（仅改显示名时）')
    p.add_argument('--scan-only', action='store_true',
                   help='只扫描+导缓存就退出，不读 name_map / 不写 CSV。用于在宿主机原生跑重扫')
    p.add_argument('--cache', type=Path, default=None, help='缓存 JSON 路径（默认 scripts/data/）')
    p.add_argument('--batch-size', type=int, default=100_000)
    p.add_argument('--limit', type=int, default=None, help='只扫前 N 行（验证用）')
    return p.parse_args()


def select_groups(freq_csv: Path, top_n: int) -> list[str]:
    """按合并后近似总量（子标签计数求和，仅用于排序）取 top-N 规范系列键。"""
    approx: dict[str, int] = defaultdict(int)
    with freq_csv.open(encoding='utf-8') as f:
        reader = csv.reader(f)
        next(reader, None)
        for row in reader:
            if row and row[0] not in _BLOCKLIST:
                approx[group_of(row[0])] += int(row[1])
    ranked = sorted(approx.items(), key=lambda kv: kv[1], reverse=True)
    return [k for k, _ in ranked[:top_n]]


def prettify(tag: str) -> str:
    return ' '.join(w[:1].upper() + w[1:] if w else w for w in tag.replace('_', ' ').split(' '))


def name_en(key: str, nm: dict) -> str:
    if key in FRANCHISE_EN:
        return FRANCHISE_EN[key]
    if key in EN_OVERRIDES:
        return EN_OVERRIDES[key]
    return strip_paren(nm.get(key, {}).get('en') or prettify(key))


def name_zh(key: str, nm: dict) -> str:
    if key in FRANCHISE_ZH:
        return FRANCHISE_ZH[key]
    if key in ZH_OVERRIDES:
        return ZH_OVERRIDES[key]
    e = nm.get(key, {})
    return strip_paren(e.get('zh_hans') or e.get('zh_hant') or e.get('en') or prettify(key))


def scan(db: Path, selected: list[str], batch_size: int, limit: int | None) -> dict:
    """单遍扫描 posts，按 (year-month, 规范系列键) 计数，每稿对每个系列至多 +1（去重）。"""
    keep = set(selected)
    monthly: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    conn = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
    try:
        total = conn.execute('SELECT COUNT(*) FROM posts').fetchone()[0]
        if limit is not None:
            total = min(total, limit)
        cur = conn.execute(f'SELECT created_at, {_COLUMN} FROM posts')
        seen, t0 = 0, time.time()
        while True:
            rows = cur.fetchmany(batch_size)
            if not rows:
                break
            for created_at, tagstr in rows:
                if not (created_at and tagstr and YM_RE.match(created_at)):
                    continue
                groups = {g for t in tagstr.split() if (g := group_of(t)) in keep}
                if groups:
                    bucket = monthly[created_at[:7]]
                    for g in groups:
                        bucket[g] += 1
            seen += len(rows)
            rate = seen / (time.time() - t0 or 1)
            sys.stderr.write(f'\r  scanned {seen:,}/{total:,}  ({rate:,.0f} rows/s)')
            sys.stderr.flush()
            if limit is not None and seen >= limit:
                break
        sys.stderr.write('\n')
    finally:
        conn.close()
    return monthly


def month_range(months: list[str]) -> list[str]:
    lo, hi = min(months), max(months)
    y, m = int(lo[:4]), int(lo[5:7])
    hy, hm = int(hi[:4]), int(hi[5:7])
    out = []
    while (y, m) <= (hy, hm):
        out.append(f'{y:04d}-{m:02d}')
        if m < 12:
            m += 1
        else:
            y, m = y + 1, 1
    return out


def ym_to_unix(ym: str) -> int:
    return calendar.timegm((int(ym[:4]), int(ym[5:7]), 1, 0, 0, 0, 0, 0, 0))


def series_values(deltas: list[int], metric: str, window: int) -> list[int]:
    """逐月 value：cumulative=累计和；trailing=滚动 window 月新增和（当前投稿速度）。"""
    cum, cums = 0, []
    for d in deltas:
        cum += d
        cums.append(cum)
    if metric == 'cumulative':
        return cums
    return [cums[i] - (cums[i - window] if i - window >= 0 else 0) for i in range(len(cums))]


def usable_months(monthly: dict) -> list[str]:
    """补齐空月，并剔除末尾「数据不完整」的月份。

    抓取常发生在月中，当月投稿数会骤降（如 2026-06 只有上月的 ~12%），月度增速榜里会让最后一帧
    所有柱断崖式塌方、严重误导。判据：末月总量 < 前三个完整月中位数的一半 → 视为不完整，剔除。"""
    months = month_range(list(monthly.keys()))
    vol = {ym: sum(monthly.get(ym, {}).values()) for ym in months}
    while len(months) > 4:
        ref = sorted(vol[m] for m in months[-4:-1])[1]  # 前三个月的中位数
        if ref > 0 and vol[months[-1]] < 0.5 * ref:
            months = months[:-1]
        else:
            break
    return months


def build_rows(monthly: dict, selected: list[str], metric: str, name_fn, nm: dict,
               window: int = TRAILING_WINDOW) -> list[dict]:
    months = usable_months(monthly)
    rows: list[dict] = []
    for key in selected:
        display = name_fn(key, nm)
        deltas = [monthly.get(ym, {}).get(key, 0) for ym in months]
        values = series_values(deltas, metric, window)
        # 只发「活跃区间」[首个>0, 末个>0]：累计榜末尾恒>0 即到末月；增速榜里死掉的系列自然淡出。
        nz = [i for i, v in enumerate(values) if v > 0]
        if not nz:
            continue
        for i in range(nz[0], nz[-1] + 1):
            rows.append({'series': display, 'tag': key, 'count': values[i],
                         'date': ym_to_unix(months[i])})
    rows.sort(key=lambda r: (r['date'], r['series']))
    return rows


def write_rows(rows: list[dict], outputs: list[Path]) -> None:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=['series', 'tag', 'count', 'date'])
    w.writeheader()
    w.writerows(rows)
    data = buf.getvalue()
    for path in outputs:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(data, encoding='utf-8')
        print(f'  wrote {len(rows):,} rows -> {path}')


def main() -> None:
    global _COLUMN, _MERGE, _BLOCKLIST
    args = parse_args()
    fld = FIELDS[args.field]
    _COLUMN, _MERGE, _BLOCKLIST = fld['column'], fld['merge'], fld['blocklist']
    freq_csv = args.freq_csv or fld['freq']
    name_map = args.name_map or fld['name_map']
    cache_path = args.cache or REPO / f"scripts/data/{fld['out']}-monthly.json"
    out = out_paths(fld['out'])

    if args.from_cache:
        if not cache_path.exists():
            sys.exit(f'cache not found: {cache_path} —— 先不带 --from-cache 跑一次全量扫描')
        cached = json.loads(cache_path.read_text(encoding='utf-8'))
        # 缓存里可能含后来加入 blocklist 的键；从 selected 过滤掉即可，无需重扫。
        selected = [k for k in cached['selected'] if k not in _BLOCKLIST]
        monthly = cached['monthly']
        print(f'[{args.field}] loaded cache: {len(selected)} groups, {len(monthly)} months')
    else:
        for path in (args.database, freq_csv):
            if not path.exists():
                sys.exit(f'not found: {path}')
        selected = select_groups(freq_csv, args.top_n)
        print(f'[{args.field}] selected {len(selected)} groups (top-{args.top_n})')
        monthly = scan(args.database, selected, args.batch_size, args.limit)
        print(f'scanned {len(monthly)} months: {min(monthly)} .. {max(monthly)}')
        if args.limit is None:
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            cache_path.write_text(json.dumps({'selected': selected, 'monthly': monthly}), encoding='utf-8')
            print(f'  cached -> {cache_path}')

    # 宿主机只负责「扫描→导缓存」这一重活；显示名映射 / 写 CSV 留给 WSL 侧（小而快）。
    if args.scan_only:
        print('scan-only: cache written, skipping name_map / CSV')
        return

    nm = json.loads(name_map.read_text(encoding='utf-8')) if name_map.exists() else {}
    # 一份缓存出两个榜：累计总量榜 + 增速榜，各出中英两版。
    for metric, out_en, out_zh in (('cumulative', out['en'], out['zh']),
                                   ('trailing', out['gen'], out['gzh'])):
        print(f'[{metric}] English:')
        write_rows(build_rows(monthly, selected, metric, name_en, nm), out_en)
        print(f'[{metric}] 中文:')
        write_rows(build_rows(monthly, selected, metric, name_zh, nm), out_zh)


if __name__ == '__main__':
    main()
