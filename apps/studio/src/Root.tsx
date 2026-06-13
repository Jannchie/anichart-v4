import { Composition } from 'remotion'
import { AA_DURATION_IN_FRAMES, AA_FPS, AAComposition } from './AAComposition'
import { AACompositionZh } from './AACompositionZh'
import { BaseComposition } from './baseComposition'

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="AniComp"
        component={BaseComposition}
        durationInFrames={60 * 60 * 2}
        fps={60}
        width={1920}
        height={1080}
      />
      <Composition
        id="AA"
        component={AAComposition}
        // 总长 = BGM(56.72s) + 片尾定格：赛跑铺在 BGM 上速度不变，BGM 奏完后多停几秒在终榜。详见 AAComposition。
        durationInFrames={AA_DURATION_IN_FRAMES}
        fps={AA_FPS}
        width={1920}
        height={1080}
      />
      <Composition
        id="AAZh"
        component={AACompositionZh}
        durationInFrames={AA_DURATION_IN_FRAMES}
        fps={AA_FPS}
        width={1920}
        height={1080}
      />
    </>
  )
}
