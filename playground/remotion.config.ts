/**
 * Note: When using the Node.JS APIs, the config file
 * doesn't apply. Instead, pass options directly to the APIs.
 *
 * All configuration options: https://remotion.dev/docs/config
 */

import { Config } from '@remotion/cli/config'

// Config.setVideoImageFormat('jpeg')
Config.setOverwriteOutput(true)
Config.setCodec('h264')
Config.setCrf(2)
Config.setConcurrency(8)
Config.setMuted(true)
Config.setChromiumOpenGlRenderer('angle')
// Config.setFrameRange([0, 200])
// Config.setLevel('verbose')
