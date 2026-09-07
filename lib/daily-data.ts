import type { DailyData } from '@/lib/daily-types'
export type { DailyData } from '@/lib/daily-types'

export const mockDailyData: DailyData = {
  asOf: '2026-09-07T15:00:00Z',
  market: { price: 78764, change24h: -1.23, marketCap: 1581000000000, volume24h: 23480000000, dominance: 59.1, fearGreed: 71, fearGreedLabel: 'Codicia' },
  catalyst: { title: 'Wall Street espera datos clave de inflación mientras Bitcoin mantiene los $78.000', source: 'CoinDesk', ago: '2h', url: '#' },
  bias: { key: 'neutral', label: 'Neutral', news: 'Levemente negativas', institutional: 'Muy alcistas', traders: 'Neutrales' },
  changes: [{ id: 'etf', label: 'ETF Spot', before: '-$186M', after: '+$24M', direction: 'positive' }, { id: 'fear-greed', label: 'Fear & Greed', before: '66', after: '71', direction: 'positive' }, { id: 'bias', label: 'Sesgo', before: 'Bajista Moderado', after: 'Neutral', direction: 'neutral' }],
  watch: [{ category: 'BTC', title: '$78.000', detail: 'Zona clave de corto plazo', importance: 'high' }, { category: 'ETF', title: 'Entradas positivas', detail: 'Vigilar continuidad compradora', importance: 'medium' }, { category: 'MACRO', title: 'Inflación EE.UU.', detail: 'Próximo catalizador', importance: 'medium' }],
  etf: { lastDay: 24200000, days7: 817450000, days30: 6788000000, change30d: 24.3 },
  derivatives: { funding: 0.0022, openInterest: 10800000000, longPct: 53.4, shortPct: 46.6, liquidations24h: 136340000 },
  news: [{ title: 'Bitcoin recupera terreno tras la caída inicial del mercado', source: 'Cointelegraph', ago: '3h', url: '#' }, { title: 'Los flujos institucionales vuelven al centro de atención', source: 'CoinDesk', ago: '4h', url: '#' }],
}

export async function getDailyData(): Promise<DailyData | null> {
  if (!process.env.DATABASE_URL) return null

  try {
    const { desc } = await import('drizzle-orm')
    const { db } = await import('@/lib/db')
    const { dailySnapshots } = await import('@/lib/db/schema')
    const [snapshot] = await db.select().from(dailySnapshots).orderBy(desc(dailySnapshots.snapshotDate)).limit(1)
    return snapshot?.payload && typeof snapshot.payload === 'object' ? snapshot.payload as DailyData : null
  } catch {
    return null
  }
}

export const formatMoney = (value: number | null, compact = false) => value == null ? 'Sin datos' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: compact ? 'compact' : 'standard', maximumFractionDigits: compact ? 2 : 0 }).format(value)
export const formatPercent = (value: number | null, digits = 2) => value == null ? 'Sin datos' : `${value > 0 ? '+' : ''}${value.toFixed(digits)}%`
export const formatDate = (value: string) => new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(value))
export const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)

export const AFFILIATE_CONFIG = { EXCHANGE_NAME: 'Nexo', AFFILIATE_URL: '#', EXCHANGE_IMAGE: '₿' }

export default mockDailyData
