export default function Sparkline({
  values,
  color = '#818cf8',
  width = 120,
  height = 30,
  threshold
}: {
  values: number[]
  color?: string
  width?: number
  height?: number
  threshold?: number
}): JSX.Element {
  if (values.length < 2) {
    return <div className="text-[10px] text-slate-600" style={{ height }}>collecting history…</div>
  }
  const top = Math.max(1, ...values)
  const x = (i: number): number => (i / (values.length - 1)) * width
  const y = (v: number): number => height - (v / top) * height
  const line = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const area = `0,${height} ${line} ${width},${height}`
  const id = `sg-${color.replace('#', '')}`
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.28" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {threshold !== undefined && threshold <= top && (
        <line x1="0" y1={y(threshold)} x2={width} y2={y(threshold)} stroke="#fb5d6b" strokeWidth="0.75" strokeDasharray="3 3" opacity="0.7" />
      )}
      <polygon points={area} fill={`url(#${id})`} />
      <polyline points={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}
