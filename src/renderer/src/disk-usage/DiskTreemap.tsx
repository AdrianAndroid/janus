import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { TreemapChart } from 'echarts/charts'
import { TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { TreemapChild } from '@shared/disk-usage'
import { fmtBytes } from './DiskUsageApp'

echarts.use([TreemapChart, TooltipComponent, CanvasRenderer])

// Stable palette assigned by node id hash — rescans don't reshuffle colors.
const PALETTE = ['#6366f1', '#34d399', '#fbbf24', '#fb5d6b', '#38bdf8', '#a78bfa', '#f472b6', '#4ade80', '#f97316', '#22d3ee']

function colorFor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

interface Props {
  items: TreemapChild[]
  scanning: boolean
  onSelect: (id: string) => void
  onDrill: (id: string) => void
}

export default function DiskTreemap({ items, scanning, onSelect, onDrill }: Props): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)
  // Single/double click disambiguation.
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!ref.current) return
    const chart = echarts.init(ref.current)
    chartRef.current = chart
    const ro = new ResizeObserver(() => chart.resize())
    ro.observe(ref.current)
    chart.on('click', (p) => {
      const id = (p.data as { id?: string })?.id
      if (!id || id.startsWith('__other__')) return
      if (clickTimer.current) clearTimeout(clickTimer.current)
      clickTimer.current = setTimeout(() => onSelect(id), 250)
    })
    chart.on('dblclick', (p) => {
      const d = p.data as { id?: string; kind?: string }
      if (!d?.id || d.id.startsWith('__other__') || d.kind !== 'directory') return
      if (clickTimer.current) {
        clearTimeout(clickTimer.current)
        clickTimer.current = null
      }
      onDrill(d.id)
    })
    return () => {
      ro.disconnect()
      if (clickTimer.current) clearTimeout(clickTimer.current)
      chart.dispose()
      chartRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    chart.setOption(
      {
        animation: false,
        tooltip: {
          formatter: (p: { name?: string; data?: { knownBytes?: number } }) =>
            `${p.name ?? ''}<br/>${fmtBytes(p.data?.knownBytes ?? 0)}`
        },
        series: [
          {
            type: 'treemap',
            width: '100%',
            height: '100%',
            nodeClick: false,
            roam: false,
            breadcrumb: { show: false },
            label: {
              show: true,
              formatter: (p: { name?: string; data?: { knownBytes?: number } }) =>
                `${p.name ?? ''}\n${fmtBytes(p.data?.knownBytes ?? 0)}`,
              fontSize: 11,
              color: '#e2e8f0'
            },
            itemStyle: { borderColor: '#0a0b0d', borderWidth: 1, gapWidth: 1 },
            data: items.map((it) => ({
              id: it.id,
              name: it.name,
              value: Math.max(it.knownBytes, 0),
              id2: it.id,
              kind: it.kind,
              knownBytes: it.knownBytes,
              itemStyle: { color: it.synthetic ? '#334155' : colorFor(it.id) }
            }))
          }
        ]
      },
      { notMerge: true }
    )
  }, [items])

  return <div ref={ref} className={`h-full w-full ${scanning ? 'opacity-80' : ''}`} />
}
