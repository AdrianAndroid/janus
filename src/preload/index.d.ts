import type { JanusApi } from './index'
import type { DiskUsageApi } from './disk-usage'

declare global {
  interface Window {
    janus: JanusApi
    diskUsage: DiskUsageApi
  }
}

export {}
