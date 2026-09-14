import { unstable_cache } from 'next/cache'
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

const readPublishedData = unstable_cache(async (): Promise<DailyData | null> => {
  if (!process.env.DATABASE_URL) return null

  try {
    const { desc, eq } = await import('drizzle-orm')
    const { db } = await import('@/lib/db')
    const { dailySnapshots, editorialEditions } = await import('@/lib/db/schema')
    const [edition] = await db.select().from(editorialEditions).where(eq(editorialEditions.status, 'valid')).orderBy(desc(editorialEditions.generatedAt)).limit(1)
    const [snapshot, ...historySnapshots] = await db.select().from(dailySnapshots).orderBy(desc(dailySnapshots.snapshotDate)).limit(31)
    const payload = edition?.payload && typeof edition.payload === 'object' ? edition.payload as DailyData : snapshot?.payload && typeof snapshot.payload === 'object' ? snapshot.payload as DailyData : null
    if (!payload) return null
    const historicalPayloads = [snapshot, ...historySnapshots].filter((row): row is NonNullable<typeof row> => Boolean(row?.payload && typeof row.payload === 'object'))
    const asHistory = (key: 'marketCap' | 'volume24h' | 'dominance' | 'fearGreed') => historicalPayloads.map((row) => { const data = row.payload as DailyData; const value = key === 'fearGreed' ? data.market?.fearGreed : data.market?.[key]; return typeof value === 'number' && Number.isFinite(value) ? { value, timestamp: `${row.snapshotDate}T12:00:00.000Z` } : null }).filter((point): point is { value: number; timestamp: string } => point !== null).sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    const existingHistory = payload.market?.history
    const historyFor = (key: 'marketCap' | 'volume24h' | 'dominance' | 'fearGreed') => { const stored = existingHistory?.[key] ?? asHistory(key); if (stored.length >= 2) return stored; const current = key === 'fearGreed' ? payload.market?.fearGreed : payload.market?.[key]; if (typeof current !== 'number' || !Number.isFinite(current)) return stored; const currentPoint = { value: current, timestamp: payload.asOf }; return [...stored, currentPoint].sort((a, b) => a.timestamp.localeCompare(b.timestamp)) }
    return { ...payload, market: { ...payload.market, history: { marketCap: historyFor('marketCap'), volume24h: historyFor('volume24h'), dominance: historyFor('dominance'), fearGreed: historyFor('fearGreed') } } }
  } catch {
    return null
  }
}, ['published-daily-data'], { revalidate: 300, tags: ['published-daily-data'] })

export function getDailyData(): Promise<DailyData | null> {
  return readPublishedData()
}

export const formatMoney = (value: number | null, compact = false) => value == null ? 'Sin datos' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: compact ? 'compact' : 'standard', maximumFractionDigits: compact ? 2 : 0 }).format(value)
export const formatPercent = (value: number | null, digits = 2) => value == null ? 'Sin datos' : `${value > 0 ? '+' : ''}${value.toFixed(digits)}%`
export const formatDate = (value: string) => new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(value))
export const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)

export const AFFILIATE_CONFIG = { EXCHANGE_NAME: 'Nexo', AFFILIATE_URL: '#', EXCHANGE_IMAGE: '₿' }

export default mockDailyData
