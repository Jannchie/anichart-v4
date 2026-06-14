/**
 * Note: When using the Node.JS APIs, the config file
 * doesn't apply. Instead, pass options directly to the APIs.
 *
 * All configuration options: https://remotion.dev/docs/config
 */

import { Config } from '@remotion/cli/config'

Config.setOverwriteOutput(true)
// 默认不静音：含 <Audio> 的 composition（AA / AAZh BGM）渲染时带声音；无 <Audio> 的（base/Go/Stocks）仍是无声轨。
Config.setMuted(false)
Config.setCodec('h264')
Config.setVideoBitrate('24M')
// jpeg 比 png 逐帧编码快很多；最终输出是不透明 h264，无需 png 无损。质量 92 保文字/细线观感。
Config.setVideoImageFormat('jpeg')
Config.setJpegQuality(92)
Config.setConcurrency(12)
Config.setChromiumOpenGlRenderer('angle')
Config.setScale(1)
