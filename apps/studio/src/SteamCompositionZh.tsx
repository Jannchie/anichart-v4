import { BarChart, colors, Config, DataProcessor, textureMap } from '@anichart/core'
import dayjs from 'dayjs'
import { Application, Texture } from 'pixi.js'
import { useEffect, useRef, useState } from 'react'
import { Audio, continueRender, delayRender, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { loadCjkFonts } from './fonts'

// Steam 游戏同时在线人数 race（中文版，与 apps/playground/src/datasets.ts 的 'steam-zh' 条目一致）。
// 数据 steam-zh.csv 来自 scripts/update-steam-data.py（SteamCharts 月均在线）。游戏名长 → 放左侧 label。
// 视频总长锁死 = BGM 长度：赛跑整段铺在 BGM 上、速度不变，乐曲结束即收尾（无片尾定格）。
// BGM Skyforge Overdrive 2.wav 实测 159.64s。
export const STEAM_BGM_SEC = 159.64
export const STEAM_FPS = 60
export const STEAM_DURATION_IN_FRAMES = Math.round(STEAM_BGM_SEC * STEAM_FPS)

// 卡点：原速（1:1）下数据第 BEAT_CONTENT 帧的画面，要落在渲染第 BEAT_RENDER 帧上（对齐 BGM 鼓点）。
// 据此把整段赛跑提速 BEAT_CONTENT/BEAT_RENDER(≈1.02×)：渲染帧 f → 数据帧 round(f×比率)。
// 跑完最后一帧后钳在末帧 → 自然静态收尾，不丢任何内容。
const BEAT_RENDER = 7968
const BEAT_CONTENT = 8127

const numberFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

// 游戏主题色：key = appid（CSV 的 appid 列，中英共用、配色稳定），取各游戏招牌色；未列入回退调色板。
const steamColorMap = new Map<number, number>([
  [570, 0xC2_3C_2A], // Dota 2 红
  [730, 0xDE_9B_35], // CS2 金橙
  [578_080, 0xF2_A9_00], // PUBG 橙
  [1_172_470, 0xDA_29_2B], // Apex 红
  [271_590, 0x6B_9F_3F], // GTA5 钞票绿
  [252_490, 0xCD_41_2B], // Rust 锈红
  [440, 0xB8_38_3B], // TF2 红队
  [1_091_500, 0xF2_E2_05], // 赛博朋克 黄
  [1_245_620, 0xC8_A9_4B], // 艾尔登 金
  [1_086_940, 0x8B_2E_2E], // 博德之门3 暗红
  [1_623_730, 0x3F_B7_A0], // 帕鲁 青
  [2_358_720, 0xB5_85_2E], // 黑神话 暗金
  [553_850, 0xF5_D0_00], // 绝地潜兵2 超级地球黄
  [1_599_340, 0xC9_A2_4B], // 失落方舟 金
  [1_085_660, 0x5B_7F_B0], // 命运2 蓝
  [230_410, 0x3A_9F_B0], // 星际战甲 青
  [105_600, 0x6F_B5_4C], // 泰拉瑞亚 绿
  [413_150, 0x8F_B5_4A], // 星露谷 草绿
  [945_360, 0xC5_11_11], // 太空狼人杀 红
  [346_110, 0xE0_7B_2C], // 方舟 橙
  [582_010, 0x2E_6F_B0], // 怪猎世界 蓝
  [1_203_220, 0x3F_A9_8A], // 永劫无间 玉
  [289_070, 0x3E_6C_A3], // 文明6 蓝
  [1_326_470, 0x5E_8B_4E], // 森林之子 绿
  [381_210, 0xA0_18_18], // 黎明杀机 暗红
  [1_568_590, 0xF2_C8_4B], // 鹅鸭杀 黄
  [10, 0x9C_7A_30], // CS1.6 暗金
  [236_390, 0x7A_7A_3A], // 战争雷霆 橄榄
  [1_938_090, 0x6E_7B_3D], // 使命召唤 军绿
  [2_357_570, 0xF0_64_14], // 守望2 橙
  [240, 0x6B_7A_8F], // CS:起源 钢蓝
  [550, 0x9E_3B_2E], // 求生之路2 锈红
  [4000, 0x3A_7C_A5], // Garry's Mod 蓝
  [8930, 0xC9_A2_27], // 文明5 金
  [39_210, 0x3B_5B_A5], // FF14 水晶蓝
  [48_700, 0x8A_6D_3B], // 战团 中世纪棕
  [49_520, 0xE8_A3_17], // 无主之地2 橙黄
  [72_850, 0x5E_6B_73], // 天际 龙石灰蓝
  [107_410, 0x6B_72_33], // 武装突袭3 军绿
  [108_600, 0x7A_8C_3A], // 僵尸毁灭工程 橄榄
  [203_770, 0x8C_6B_2F], // 十字军之王2 王金
  [211_820, 0x2F_A4_A0], // 星界边境 太空青
  [214_950, 0xB2_3A_2A], // 罗马2 罗马红
  [218_620, 0x2E_9E_4F], // 收获日2 钞票绿
  [221_100, 0x8A_7A_4A], // DayZ 卡其
  [227_300, 0x2E_6D_B4], // 欧卡2 公路蓝
  [236_850, 0x3C_7A_6E], // 欧陆风云4 地图青
  [238_960, 0x8C_2E_22], // 流放之路 血红
  [250_900, 0x6B_4A_2A], // 以撒 阴沉棕
  [251_570, 0x8A_5A_2B], // 七日杀 锈橙
  [252_950, 0x2E_7C_E6], // 火箭联盟 电蓝
  [255_710, 0x4C_A6_4C], // 城市天际线 城市绿
  [261_550, 0x8C_3A_2E], // 霸主 绯红
  [268_500, 0x2E_8C_6A], // 幽浮2 青绿
  [275_850, 0xE0_61_2C], // 无人深空 宇宙橙
  [284_160, 0x5B_7A_99], // BeamNG 金属蓝灰
  [292_030, 0xA8_23_1F], // 巫师3 猎魔红
  [294_100, 0xB5_8A_4A], // 边缘世界 土黄
  [304_930, 0x6F_A8_4C], // Unturned 方块绿
  [322_170, 0x2E_C4_B6], // 几何冲刺 青
  [322_330, 0x6B_5B_45], // 饥荒 阴郁棕
  [359_320, 0xF0_7B_05], // 精英危险 橙
  [359_550, 0xD9_77_2E], // 彩虹六号 橙
  [364_360, 0xA8_3A_2A], // 战锤全战 红金
  [365_590, 0xE8_73_1F], // 全境封锁 SHD橙
  [374_320, 0xB5_53_2A], // 黑魂3 余烬橙
  [377_160, 0x3F_A3_4D], // 辐射4 Pip绿
  [386_360, 0xC9_A2_4B], // 神之浩劫 神金
  [394_360, 0x8C_7A_4A], // 钢铁雄心4 战图褐
  [427_520, 0xD9_83_24], // 异星工厂 工业橙
  [433_850, 0xC2_3B_2A], // H1Z1 大逃杀红
  [438_100, 0x2E_A7_C4], // VRChat 蓝
  [440_900, 0xB5_61_2E], // 流放者柯南 沙红
  [444_090, 0x2E_9E_8F], // 圣金枪手 青金
  [457_140, 0x2E_9E_A8], // 缺氧 青
  [489_830, 0x72_85_96], // 天际特别版 钢蓝
  [526_870, 0xF2_92_2A], // 幸福工厂 FICSIT橙
  [548_430, 0xE0_A9_2E], // 深岩银河 金
  [582_660, 0x9A_2E_3A], // 黑色沙漠 绯暗红
  [594_650, 0x8A_5A_3A], // 猎杀对决 血棕
  [739_630, 0x3E_8C_9E], // 恐鬼症 冷青
  [813_780, 0x2E_5C_9E], // 帝国时代2 皇蓝
  [892_970, 0x4A_6E_7A], // 英灵神殿 维京蓝灰
  [990_080, 0xB5_89_2E], // 霍格沃茨 格兰芬多金
  [1_063_730, 0x2E_8C_6E], // 新世界 永恒之地青
  [1_097_150, 0xE8_5A_A0], // 糖豆人 粉
  [1_142_710, 0x9A_2A_22], // 战锤3 库恩红
  [1_145_360, 0xC9_40_2E], // 哈迪斯 冥红
  [1_158_310, 0x9E_7A_38], // 十字军之王3 王金
  [1_172_620, 0x2E_9E_9A], // 盗贼之海 海盗青
  [1_174_180, 0xB2_3A_2A], // 大镖客2 红
  [1_203_620, 0x4A_8C_8A], // 笼罩 雾青
  [1_222_670, 0x3F_B2_3F], // 模拟人生4 绿钻
  [1_363_080, 0x7A_6B_3A], // 庄园领主 中世纪褐
  [1_364_780, 0xE0_55_2E], // 街霸6 橙红
  [1_426_210, 0xE0_70_3A], // 双人成行 暖橙
  [1_446_780, 0x3E_9E_7A], // 怪猎崛起 翠
  [1_449_850, 0x7A_3E_9E], // 游戏王 紫金
  [1_517_290, 0x3A_6E_A8], // 战地2042 蓝
  [1_551_360, 0x2E_9E_E0], // 地平线5 亮蓝
  [1_665_460, 0x2E_5C_B8], // eFootball 蓝
  [1_794_680, 0x8C_3E_9E], // 吸血鬼幸存者 紫
  [1_808_500, 0xC9_7A_2E], // ARC Raiders 橙
  [1_943_950, 0xC9_B8_4A], // 逃离后室 后室黄
  [1_962_700, 0x2E_9E_C4], // 深海迷航2 海蓝
  [1_966_720, 0x4A_8C_5A], // 致命公司 工业绿
  [2_050_650, 0xB2_2A_2A], // 生化危机4 红
  [2_073_620, 0x7A_8C_4A], // 暗区突围 战术绿
  [2_074_920, 0x3E_8C_D0], // 第一后裔 青蓝
  [2_139_460, 0x6E_9E_5A], // 七日世界 诡绿
  [2_183_900, 0x2E_5C_A8], // 星际战士2 群青
  [2_246_340, 0x4A_8C_7A], // 怪猎荒野 沙青
  [2_300_320, 0x6E_A8_2E], // 模拟农场25 拖拉机绿
  [2_379_780, 0xD0_41_3E], // 小丑牌 扑克红
  [2_399_830, 0xE0_8A_3A], // 方舟飞升 橙
  [2_483_190, 0x8C_5C_E0], // 地平线6 紫
  [2_507_950, 0x6E_8C_3A], // 三角洲 军绿
  [2_622_380, 0x8C_7A_3A], // 黑夜君临 暗金
  [2_694_490, 0xA8_3A_2E], // 流放之路2 绯红
  [2_767_030, 0xE0_38_2B], // 漫威争锋 漫威红
  [2_807_960, 0x2E_6E_9E], // 战地6 蓝
  [2_868_840, 0x9E_3A_4A], // 杀戮尖塔2 红紫
  [3_065_800, 0x2E_C4_C0], // Marathon 青
  [3_164_500, 0x5E_8C_4A], // Schedule I 暗绿
  [3_241_660, 0x4A_9E_8A], // R.E.P.O. 青绿
  [3_321_460, 0xB0_2A_2E], // 红色沙漠 绯红
  [3_405_690, 0x2E_9E_5A], // EA FC26 球场绿
  [3_472_040, 0xE0_7B_2A], // NBA2K26 篮球橙
  [3_513_350, 0x2E_B8_C4], // 鸣潮 青
  [3_527_290, 0xE0_92_2E], // PEAK 山橙
  [3_551_340, 0x2E_7C_5A], // 足球经理26 绿
  [3_564_740, 0x3E_9E_8A], // 燕云十六声 水墨青
  [3_932_890, 0x7A_6E_4A], // 逃离塔科夫 橄榄
  [218_230, 0x2E_8C_C4], // 行星边际2 青蓝
  [202_970, 0xC9_5A_2A], // 黑色行动2 橙
  [221_380, 0xB8_9A_4A], // 帝国时代2HD 金
  [219_640, 0x9E_45_38], // 骑士精神 钢红
  [200_710, 0xE8_A2_3A], // 火炬之光2 琥珀
  [1250, 0x9E_2E_2E], // 杀戮空间 暗红
  [232_090, 0xB0_2E_3A], // 杀戮空间2 绯红
  [200_510, 0x2E_7C_7A], // 幽浮未知敌人 青绿
  [219_740, 0x7A_68_50], // 饥荒 暗褐
  [113_200, 0x7A_5A_38], // 以撒 土褐
  [4920, 0x2E_9E_B0], // 自然选择2 青
  [65_800, 0x3E_6E_B0], // 地牢守护者 蓝
  [55_230, 0x8C_3E_B0], // 黑道圣徒3 紫
  [34_330, 0xCC_3A_30], // 幕府将军2 武士红
  [222_880, 0x8A_7A_3A], // 叛乱 卡其
  [8500, 0xD0_A8_3E], // EVE 星空金
  [17_080, 0x3E_8C_C4], // Tribes 科幻蓝
  [200_210, 0xC9_4A_8C], // RotMG 品红
  [204_300, 0x5A_B0_4A], // Awesomenauts 绿
  [99_900, 0x4A_8C_C4], // Spiral Knights 钢蓝
  [1_599_600, 0xE8_9A_3A], // PlateUp! 橙
  [1_240_440, 0x2E_7C_B0], // 光环无限 蓝
  [2_073_850, 0xE0_3A_4A], // THE FINALS 红
  [976_730, 0x4A_8C_3A], // 光环MCC 绿
  [1_238_810, 0x6E_8C_5A], // 战地5 橄榄
  [1_238_840, 0x9A_7A_4A], // 战地1 一战褐
  [686_810, 0x6E_6B_3A], // 人间地狱 军绿
  [393_380, 0x5A_6E_3A], // Squad 军绿
  [581_320, 0xB5_89_5A], // 叛乱沙暴 沙黄
  [1_144_200, 0x4A_5A_7A], // 严阵以待 战术蓝
  [291_550, 0x3E_7C_C4], // 英灵乱斗 蓝
  [1_778_820, 0x9E_3E_7A], // 铁拳8 紫
  [2_344_520, 0xB0_1E_1E], // 暗黑4 地狱红
  [899_770, 0x5A_6E_C0], // 最后纪元 时之蓝
  [632_360, 0xD9_72_2E], // 雨中冒险2 橙
  [306_130, 0xB5_91_2E], // 上古卷轴OL 金
  [2_054_970, 0xC2_5A_2E], // 龙之信条2 红
  [1_771_300, 0xA8_40_30], // 天国拯救2 波西米亚红
  [1_145_350, 0x6E_4A_9E], // 哈迪斯2 巫紫
  [588_650, 0x3E_A8_9A], // 死亡细胞 青
  [1_604_030, 0x8C_2A_3A], // 夜族崛起 血红
  [648_800, 0x3E_9E_B0], // 木筏求生 海蓝
  [242_760, 0x4A_7A_3E], // 森林 暗绿
  [264_710, 0x2E_88_C0], // 深海迷航 深蓝
  [962_130, 0x6E_A8_3A], // 禁闭求生 后院绿
  [1_621_690, 0xC9_92_3A], // 核心守护者 琥珀
  [1_782_210, 0xE0_5A_8C], // 螃蟹游戏 粉
  [2_881_650, 0x4A_9E_7A], // Content Warning 青绿
  [2_670_630, 0x3A_8C_C4], // 超市模拟器 蓝
  [281_990, 0x4A_5A_C0], // 群星 星蓝
  [779_340, 0xCC_40_30], // 全战三国 红
  [1_934_680, 0xC9_A2_3A], // 神话时代重述 金
  [1_677_280, 0x7A_6E_3A], // 英雄连3 橄榄
  [949_230, 0x3E_9E_7A], // 城市天际线2 青
  [270_880, 0xC2_50_3A], // 美卡 美国路红
  [2_429_640, 0x7A_5C_B0], // 王权与自由 紫金
  [2_001_120, 0xC8_5A_B0], // 双影奇境 橙紫
  [1_903_340, 0xB5_9A_4A], // 光与影33 金
  [1_282_100, 0xB5_72_2E], // 遗迹2 琥珀
  [1_361_210, 0x8C_2A_22], // 暗潮 40K暗红
  [1_623_660, 0xC9_9A_3A], // 传奇4 金
  [1_295_660, 0x3E_8C_9A], // 文明7 青金
  [2_456_740, 0x5A_B0_A0], // inZOI 生活青
  [2_479_810, 0x6E_7A_5A], // 灰区战争 灰绿
  [1_818_750, 0x3E_7C_C8], // MultiVersus 蓝
  [424_370, 0x8C_3E_5A], // Wolcen 暗红紫
  [680_420, 0xC9_5A_2E], // Outriders 橙
  [552_500, 0x7A_2E_22], // 末世鼠疫2 鼠疫暗红
  [1_466_860, 0x3E_5C_8C], // 帝国时代4 蓝
  [677_620, 0x3E_A8_C4], // Splitgate 传送青
  [629_760, 0x8A_4A_3A], // Mordhau 铁锈
  [646_570, 0x8C_5A_B0], // 杀戮尖塔 紫
  [323_190, 0x5A_8C_B0], // 冰汽时代 寒蓝
])

function steamColor(appid: string | undefined): number {
  const c = appid ? steamColorMap.get(Number(appid)) : undefined
  if (c !== undefined) {
    return c
  }
  const colorStr = appid ? colors(appid) : undefined
  return colorStr ? Number.parseInt(colorStr.slice(1), 16) : 0x88_88_88
}

const config = new Config({
  // 身份用 appid（稳定键）→ 同一游戏一条连续柱；显示名用 game 列，可随时间变（CS:GO→CS2 原地重写）。
  id: 'appid',
  step: 'date',
  value: 'players',
  // 柱右端 banner = Steam 横版 capsule，按 logo 列取（多数=appid；appid 730 在 2023-09 前=730-csgo→CS:GO 旧封面，
  // 之后=730→CS2。core 逐帧按 logo 切贴图并交叉淡入）。capsule 由 scripts/update-steam-logos.py 下载到 public/steam-logos。
  image: 'logo',
  // 左侧 label = game 列（游戏名）。与 id 解耦后，game 列中途改名不会断柱，而是原地重写。
  label: 'game',
  topN: 18,
  showLabel: true,
  // banner 已含封面+标题，柱上不再叠文字（避免与 logo 抢位）。
  getBarInfo: () => '',
  valueScale: { type: 'from-zero' },
  // 拉丁/数字走等宽 Berkeley Mono，汉字按字回退到 HarmonyOS Sans SC。
  fontFamily: 'Berkeley Mono, HarmonyOS Sans SC',
  color: d => steamColor(d.raw?.appid),
  // 三处文本分工、互不重复：轴标题=度量单位（唯一出现「同时在线」处）、标题=主题、副标题=范围+来源。
  xAxisLabel: '同时在线玩家（月均）',
  title: 'Steam 最热门游戏',
  subtitle: '历代人气变迁 · 数据来源 SteamCharts',
  getStepLabel: step => dayjs(step * 1000).format('YYYY-MM'),
  y: 0,
  totalDurationSec: 120,
  // 在线人数是离散计数 → 整数全数字，不套万/亿。
  getValueLabel: d => numberFmt.format(d.value),
  getTickLabel: v => numberFmt.format(v),
})
const app = new Application()

async function init({
  fps,
  width,
  height,
  durationInFrames,
}: {
  fps: number
  width: number
  height: number
  durationInFrames: number
}) {
  config.fps = fps
  config.canvasWidth = width
  config.canvasHeight = height
  // 赛跑整段铺满 BGM（durationInFrames = BGM 帧数），速度不变；首尾各留一次 swap 的余量。
  config.totalDurationSec = durationInFrames / fps - config.swapDurationSec * 2
  // 中文版需 Berkeley Mono + HarmonyOS 两套；构建 BarChart（创建 PIXI Text，含汉字测量）前必须 await。
  const fontReady = loadCjkFonts()
  const data = await DataProcessor.processCSV(staticFile('steam-zh.csv'), config)

  // 横版 banner 按 logo 列取（image:'logo' → BarChart 从 textureMap.get(d.raw.logo) 取图），
  // 必须在构建 BarChart 前加载完。logo 值多为 appid，appid 730 另有 730-csgo（CS:GO 旧封面）。
  // capsule 是 jpg、无透明，直接 Texture.from(image) 即可。
  const logos = [...new Set(data.flat().map(d => String(d.raw?.logo ?? '')).filter(Boolean))]
  await Promise.all(logos.map(async (logo) => {
    if (textureMap.has(logo)) {
      return
    }
    try {
      const image = new Image()
      image.src = staticFile(`steam-logos/${logo}.jpg`)
      await image.decode()
      textureMap.set(logo, Texture.from(image))
    }
    catch {
      // 没有 banner 的游戏跳过（柱子照常显示，只是没右端图）。
    }
  }))
  await fontReady

  await app.init({
    width: config.canvasWidth,
    height: config.canvasHeight,
    backgroundColor: config.backgroundColor,
    roundPixels: true,
    antialias: true,
    // 见 AAComposition：按 devicePixelRatio 提分辨率，配合 --scale 渲染真 4K。
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  })
  document.querySelector('#canvas-el')?.replaceWith(app.canvas)

  const barChart = new BarChart(data, config)
  app.stage.addChild(barChart)
  barChart.update(0)
  return barChart
}

export function SteamCompositionZh() {
  const bar = useRef<BarChart>(undefined)
  const { width, height, fps, durationInFrames } = useVideoConfig()
  const [handle] = useState(() => delayRender())
  const frame = useCurrentFrame()
  // 渲染时每个并发 chunk 的首帧都以「挂载帧」重新 mount；init 收尾的 update(0) 会让这些帧闪回起始态。
  // 用 ref 记住当前帧，init 完成时同步渲到该帧（而非 0），消除 chunk 首帧闪烁。
  const frameRef = useRef(frame)
  frameRef.current = frame
  // 卡点提速：渲染帧 → 数据帧（比率 BEAT_CONTENT/BEAT_RENDER），末帧后冻结静态。
  const frameToIdx = (f: number, b: BarChart) => Math.min(Math.round(f * BEAT_CONTENT / BEAT_RENDER), b.data.length - 1)
  useEffect(() => {
    init({
      fps,
      width,
      height,
      durationInFrames,
    }).then((res) => {
      bar.current = res
      res.update(frameToIdx(frameRef.current, res))
      continueRender(handle)
    })
  }, [])

  useEffect(() => {
    if (bar.current) {
      bar.current.update(frameToIdx(frame, bar.current))
    }
  }, [frame])

  return (
    <>
      {/* 见 AAComposition：仅供 Studio 预览发声；成片 BGM 由 `pnpm render:steamzh` 脚本用 ffmpeg mux 上去。 */}
      <Audio src={staticFile('skyforge-overdrive-2.wav')} volume={0.7} />
      <canvas id="canvas-el" />
    </>
  )
}
