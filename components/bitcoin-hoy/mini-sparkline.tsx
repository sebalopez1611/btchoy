import type { CSSProperties } from 'react'

export function MiniSparkline({ values }: { values?: number[] }) {
  const points = (values ?? []).filter((value) => Number.isFinite(value))
  if (points.length < 2) return null
  const min = Math.min(...points)
  const max = Math.max(...points)
  const range = max - min || 1
  const path = points.map((value, index) => {
    const x = (index / (points.length - 1)) * 88
    const y = 28 - ((value - min) / range) * 24
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
  }).join(' ')
  const delta = points.at(-1)! - points[0]
  const relativeDelta = Math.abs(points[0]) > 0 ? Math.abs(delta / points[0]) : Math.abs(delta)
  const tone = relativeDelta < 0.002 ? 'var(--warning)' : delta > 0 ? 'var(--positive)' : 'var(--negative)'
  return <svg className="mini-sparkline" viewBox="0 0 88 32" role="img" aria-label="Tendencia reciente" style={{ '--sparkline-color': tone } as CSSProperties}><path d={path} fill="none" opacity="0.78" stroke="var(--sparkline-color)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
}
