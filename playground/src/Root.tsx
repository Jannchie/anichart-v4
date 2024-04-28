import { Composition } from 'remotion'
import { BaseComposition } from './baseComposition'

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="AniComp"
      component={BaseComposition}
      durationInFrames={60 * 10}
      fps={60}
      width={1920}
      height={1080}
    />
  )
}
