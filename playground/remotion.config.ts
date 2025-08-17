/**
 * Note: When using the Node.JS APIs, the config file
 * doesn't apply. Instead, pass options directly to the APIs.
 *
 * All configuration options: https://remotion.dev/docs/config
 */

import { Config } from '@remotion/cli/config'

Config.setOverwriteOutput(true)
Config.setMuted(true)
Config.setCodec('h264')
Config.setVideoBitrate('24M')
Config.setVideoImageFormat('png')
Config.setConcurrency(8)
Config.setChromiumOpenGlRenderer('angle')
Config.setScale(1)
