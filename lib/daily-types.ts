export type HistoryPoint = { value: number; timestamp: string }

export type DailyData = {
  asOf: string
  market: { price: number | null; change24h: number | null; marketCap: number | null; volume24h: number | null; dominance: number | null; fearGreed: number | null; fearGreedLabel: string | null; history?: { marketCap: HistoryPoint[]; volume24h: HistoryPoint[]; dominance: HistoryPoint[]; fearGreed: HistoryPoint[] } }
  catalyst: { title: string; titleOriginal?: string; source: string; ago: string | null; url: string | null; imageUrl?: string | null } | null
  bias: { key: 'bullish' | 'moderately_bullish' | 'neutral' | 'moderately_bearish' | 'bearish'; label: string; news: string | null; institutional: string | null; traders: string | null; asOf?: string | null; stale?: boolean } | null
  changes: Array<{ id: string; label: string; before: string; after: string; direction: 'positive' | 'negative' | 'neutral' }>
  watch: Array<{ category: string; title: string; detail: string; importance: 'high' | 'medium' | 'low' }>
  etf: { lastDay: number | null; lastDayDate?: string | null; days7: number | null; days30: number | null; change30d: number | null } | null
  derivatives: { funding: number | null; openInterest: number | null; longPct: number | null; shortPct: number | null; liquidations24h: number | null } | null
  news: Array<{ title: string; titleOriginal?: string; source: string; ago: string | null; url: string | null }>
}

export const formatMoney = (value: number | null, compact = false) => value == null ? 'Sin datos' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: compact ? 'compact' : 'standard', maximumFractionDigits: compact ? 2 : 0 }).format(value)
export const formatPercent = (value: number | null, digits = 2) => value == null ? 'Sin datos' : `${value > 0 ? '+' : ''}${value.toFixed(digits)}%`
export const AFFILIATE_CONFIG = { EXCHANGE_NAME: 'Nexo', AFFILIATE_URL: '#', EXCHANGE_IMAGE: '₿' }
