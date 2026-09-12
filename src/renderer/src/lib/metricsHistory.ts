import type { ServerMetrics } from '@shared/types'

export interface Sample {
  t: number
  cpu: number // load[0] / cpuCount (0..1+)
  mem: number // 0..1
  disk: number // 0..1
}

const CAP = 120
const store: Record<string, Sample[]> = {}
const alertState: Record<string, boolean> = {}
const ALERT = 0.9

/** Derive 0..1 ratios from a metrics snapshot. */
export function ratios(m: ServerMetrics): { cpu: number; mem: number; disk: number } {
  const mem = m.memTotal ? (m.memUsed ?? 0) / m.memTotal : 0
  const disk = m.diskTotal ? (m.diskUsed ?? 0) / m.diskTotal : 0
  const cpu = m.cpuCount && m.load ? m.load[0] / m.cpuCount : 0
  return { cpu, mem, disk }
}

export function record(id: string, s: Sample): void {
  const arr = (store[id] ||= [])
  arr.push(s)
  if (arr.length > CAP) arr.shift()
}

export function history(id: string): Sample[] {
  return store[id] || []
}

/** Fire a notification when a metric first crosses the alert threshold. */
export function checkAlerts(
  id: string,
  name: string,
  r: { cpu: number; mem: number; disk: number },
  notify: (title: string, body: string) => void
): void {
  const checks: [string, number][] = [
    ['RAM', r.mem],
    ['Disk', r.disk],
    ['CPU load', r.cpu]
  ]
  for (const [label, ratio] of checks) {
    const key = `${id}:${label}`
    const over = ratio >= ALERT
    if (over && !alertState[key]) {
      notify(`⚠️ ${name} — high ${label}`, `${label} ${Math.round(ratio * 100)}% (threshold ${ALERT * 100}% exceeded).`)
    }
    alertState[key] = over
  }
}
