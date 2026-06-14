// PIXI 的 Text 在创建时就按当前可用字体测量，所以必须在建图（new BarChart）之前 await 字体就绪，
// 否则首批文本会按系统回退字体测量、汉字直接变豆腐块。
//
// 字体栈与 apps/studio/src/fonts.ts 一致：Berkeley Mono（拉丁/数字，等宽）+ HarmonyOS Sans SC
// （汉字）。Config.fontFamily 写成 'Berkeley Mono, HarmonyOS Sans SC'，canvas 按字回退——拉丁
// 走等宽、汉字走 HarmonyOS。两种字重都显式加载：标题 / 柱上文本是 bold，缺 bold 时部分系统会拿
// 系统粗体 CJK 衬线（明朝）顶替，导致汉字回退成衬线。文件在 public/fonts/（Vite 根路径直接取）。
//
// 幂等：重复调用复用同一 Promise。
let fontsReady: Promise<void> | undefined

const FACES: Array<[string, string, FontFaceDescriptors]> = [
  ['Berkeley Mono', '/fonts/BerkeleyMono-Regular.ttf', { weight: 'normal' }],
  ['Berkeley Mono', '/fonts/BerkeleyMono-Bold.ttf', { weight: 'bold' }],
  ['HarmonyOS Sans SC', '/fonts/HarmonyOS_Sans_SC_Regular.ttf', { weight: 'normal' }],
  ['HarmonyOS Sans SC', '/fonts/HarmonyOS_Sans_SC_Bold.ttf', { weight: 'bold' }],
]

export function loadFonts(): Promise<void> {
  if (!fontsReady) {
    fontsReady = (async () => {
      await Promise.all(FACES.map(async ([family, url, desc]) => {
        const face = new FontFace(family, `url(${url})`, desc)
        await face.load()
        document.fonts.add(face)
      }))
      await document.fonts.ready
    })()
  }
  return fontsReady
}

// 全数据集共用的字体栈：拉丁走 Berkeley Mono、汉字回退 HarmonyOS Sans SC。
export const FONT_STACK = 'Berkeley Mono, HarmonyOS Sans SC'
