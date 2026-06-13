import { staticFile } from 'remotion'

// Remotion 无头 Chrome 不带系统字体，必须把 Berkeley Mono（Config 默认 fontFamily）打包进
// public/fonts 并显式加载，否则 PIXI 文本会回退成衬线。必须在构建 BarChart（创建 PIXI Text）
// 之前 await，否则首批文本会按回退字体测量。幂等：多个 composition 共用同一 Promise。
let fontsReady: Promise<void> | undefined

async function addFaces(faces: FontFace[]): Promise<void> {
  await Promise.all(faces.map(async (face) => {
    await face.load()
    document.fonts.add(face)
  }))
  await document.fonts.ready
}

export function loadBerkeleyMono(): Promise<void> {
  if (!fontsReady) {
    fontsReady = addFaces([
      new FontFace('Berkeley Mono', `url(${staticFile('fonts/BerkeleyMono-Regular.ttf')})`, { weight: 'normal' }),
      new FontFace('Berkeley Mono', `url(${staticFile('fonts/BerkeleyMono-Bold.ttf')})`, { weight: 'bold' }),
    ])
  }
  return fontsReady
}

// 中文版用：Berkeley Mono（拉丁/数字）+ HarmonyOS Sans SC（汉字）。fontFamily 写成
// 'Berkeley Mono, HarmonyOS Sans SC'，canvas 会按字回退——拉丁走等宽、汉字走 HarmonyOS。
// HarmonyOS 仅 Regular，标题的 bold 由 canvas 合成伪粗。
let cjkReady: Promise<void> | undefined
export function loadCjkFonts(): Promise<void> {
  if (!cjkReady) {
    cjkReady = Promise.all([
      loadBerkeleyMono(),
      addFaces([
        new FontFace('HarmonyOS Sans SC', `url(${staticFile('fonts/HarmonyOS_Sans_SC_Regular.ttf')})`, { weight: 'normal' }),
        // 必须显式提供 bold 字重：标题 / 柱上 model 名是 bold，缺 bold 时部分系统（如日文环境）
        // 会拿系统的粗体 CJK 衬线（明朝）顶替，导致汉字回退成衬线。
        new FontFace('HarmonyOS Sans SC', `url(${staticFile('fonts/HarmonyOS_Sans_SC_Bold.ttf')})`, { weight: 'bold' }),
      ]),
    ]).then(() => {})
  }
  return cjkReady
}
