'use client'

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import type { HistoryPoint } from '@/lib/daily-types'

const chartConfig = {
  price: { label: 'BTC / USD', color: 'var(--chart-1)' },
} satisfies ChartConfig

const formatPrice = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
const formatCompactPrice = (value: number) => `$${new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value)}`
const formatDateTime = (value: number, intraday: boolean) => new Intl.DateTimeFormat('es-AR', intraday ? { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' } : { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(value))

export function StoredPriceChart({ values = [] }: { values?: HistoryPoint[] }) {
  const chartData = [...new Map(values
    .filter((point) => Number.isFinite(point.value) && Number.isFinite(new Date(point.timestamp).getTime()))
    .map((point) => [new Date(point.timestamp).getTime(), point.value] as const))]
    .sort(([first], [second]) => first - second)
    .map(([timestamp, price]) => ({ timestamp, price }))

  if (chartData.length < 2) {
    return <div className="chart-history-empty" role="status"><strong>Histórico de precios aún no disponible.</strong><span>Se mostrará con los precios guardados en la próxima edición completa.</span></div>
  }

  const intraday = chartData.at(-1)!.timestamp - chartData[0].timestamp <= 26 * 60 * 60 * 1000
  const firstLabel = formatDateTime(chartData[0].timestamp, intraday)
  const lastLabel = formatDateTime(chartData.at(-1)!.timestamp, intraday)
  const latestPrice = chartData.at(-1)!.price

  return <div className="stored-price-chart">
    <ChartContainer config={chartConfig} className="h-[280px] w-full" role="img" aria-label={`Histórico guardado de BTC en dólares: ${chartData.length} observaciones, de ${firstLabel} a ${lastLabel}. Último precio ${formatPrice(latestPrice)}.`}>
      <AreaChart data={chartData} accessibilityLayer margin={{ top: 14, right: 10, left: 4, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 5" />
        <XAxis dataKey="timestamp" type="number" scale="time" domain={['dataMin', 'dataMax']} tickCount={4} tickLine={false} axisLine={false} tickMargin={10} tickFormatter={(value) => formatDateTime(Number(value), intraday)} />
        <YAxis dataKey="price" domain={['auto', 'auto']} tickLine={false} axisLine={false} tickMargin={8} width={64} tickFormatter={(value) => formatCompactPrice(Number(value))} />
        <ChartTooltip content={<ChartTooltipContent labelFormatter={(value) => formatDateTime(Number(value), intraday)} formatter={(value) => formatPrice(Number(value))} indicator="line" />} />
        <Area type="monotone" dataKey="price" stroke="var(--color-price)" fill="var(--color-price)" fillOpacity={0.12} strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: 'var(--color-price)' }} />
      </AreaChart>
    </ChartContainer>
    <div className="stored-price-caption"><span>{chartData.length} observaciones guardadas</span><span>{firstLabel} – {lastLabel} UTC</span></div>
  </div>
}
