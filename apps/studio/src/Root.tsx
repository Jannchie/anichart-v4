import { Composition } from 'remotion'
import { AA_DURATION_IN_FRAMES, AA_FPS, AAComposition } from './AAComposition'
import { AACompositionZh } from './AACompositionZh'
import { BaseComposition } from './baseComposition'
import { EV_DURATION_IN_FRAMES, EV_FPS, EVCompositionZh, EVCompositionZhVertical } from './EVCompositionZh'
import { STEAM_DURATION_IN_FRAMES, STEAM_FPS, SteamCompositionZh } from './SteamCompositionZh'

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
      <Composition
        id="SteamZh"
        component={SteamCompositionZh}
        // 视频总长 = BGM(skyforge-overdrive-2.wav, 159.64s)：赛跑整段铺在 BGM 上，乐曲结束即收尾。
        durationInFrames={STEAM_DURATION_IN_FRAMES}
        fps={STEAM_FPS}
        width={1920}
        height={1080}
      />
      <Composition
        id="EVZh"
        component={EVCompositionZh}
        // 视频总长 = BGM(helios-grid-rising.wav, 139.44s) + 片尾定格：赛跑占前 EV_RACE_SEC，余下冻结在终榜。
        durationInFrames={EV_DURATION_IN_FRAMES}
        fps={EV_FPS}
        width={1920}
        height={1080}
      />
      <Composition
        id="EVZhVertical"
        component={EVCompositionZhVertical}
        // 竖屏 9:16 特供抖音等手机端；时间轴 / BGM 与横屏版一致。
        durationInFrames={EV_DURATION_IN_FRAMES}
        fps={EV_FPS}
        width={1080}
        height={1920}
      />
    </>
  )
}
