import type { JanusApi } from './index'
import type { DiskUsageApi } from './disk-usage'
import type { VncApi } from './vnc'

declare global {
  interface Window {
    janus: JanusApi
    diskUsage: DiskUsageApi
    vnc: VncApi
  }
}

export {}
