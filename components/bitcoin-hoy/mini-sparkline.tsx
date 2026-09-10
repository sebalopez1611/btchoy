import type { CSSProperties } from 'react'
import type { HistoryPoint } from '@/lib/daily-types'

export function MiniSparkline({ values, label }: { values?: HistoryPoint[]; label?: string }) {
  const points = (values ?? []).filter((point) => Number.isFinite(point.value) && Number.isFinite(new Date(point.timestamp).getTime())).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
  const numericValues = points.map((point) => point.value)
  if (points.length < 2) return null
  const min = Math.min(...numericValues)
  const max = Math.max(...numericValues)
  const range = Math.max(max - min, Math.abs(max || min) * 0.01, 1)
  const midpoint = (max + min) / 2
  const path = numericValues.map((value, index) => {
    const x = (index / (points.length - 1)) * 88
    const y = 16 - ((value - midpoint) / range) * 24
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
  }).join(' ')
  const delta = numericValues.at(-1)! - numericValues[0]
  const relativeDelta = Math.abs(numericValues[0]) > 0 ? Math.abs(delta / numericValues[0]) : Math.abs(delta)
  const tone = relativeDelta < 0.002 ? 'var(--warning)' : delta > 0 ? 'var(--positive)' : 'var(--negative)'
  const firstDate = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(points[0].timestamp))
  const lastDate = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(points.at(-1)!.timestamp))
  const period = `${firstDate}–${lastDate}`
  const change = numericValues[0] === 0 ? 0 : ((numericValues.at(-1)! - numericValues[0]) / Math.abs(numericValues[0])) * 100
  const description = `${label ?? 'Serie'}: ${points.length} observaciones, ${period}, cambio ${change >= 0 ? '+' : ''}${change.toFixed(2)}%.`
  return <svg className="mini-sparkline" viewBox="0 0 88 32" role="img" aria-label={description} style={{ '--sparkline-color': tone } as CSSProperties}><title>{description}</title><line x1="0" y1="16" x2="88" y2="16" stroke="var(--border)" strokeWidth="1" opacity=".35" /><path d={path} fill="none" opacity=".9" stroke="var(--sparkline-color)" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
}
