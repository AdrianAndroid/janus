import type { JanusApi } from './index'
import type { DiskUsageApi } from './disk-usage'
import type { VncApi } from './vnc'
import type { PlayerApi } from './player'
import type { ViewerApi } from './viewer'

declare global {
  interface Window {
    janus: JanusApi
    diskUsage: DiskUsageApi
    vnc: VncApi
    player: PlayerApi
    viewer: ViewerApi
  }
}

export {}
