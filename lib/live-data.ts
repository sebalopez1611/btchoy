import { z } from 'zod'
import type { DailyData } from '@/lib/daily-types'

const XOOMAR_BASE = 'https://xoomar.com/api'
const SOURCE_TIMEOUT_MS = 7000

export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(typeof value === 'string' ? value.replace(/[$,%\s,]/g, '') : value)
  return Number.isFinite(n) ? n : null
}

const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null
const rowsOf = (value: any): any[] => Array.isArray(value?.data) ? value.data : Array.isArray(value) ? value : []

async function sourceJson(path: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS)
  try {
    const response = await fetch(path, { signal: controller.signal, next: { revalidate: 300 } })
    const json = await response.json().catch(() => ({}))
    return { json, httpStatus: response.status }
  } finally { clearTimeout(timeout) }
}

async function rss(url: string, source: string) {
  const response = await fetch(url, { next: { revalidate: 300 }, signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS) })
  const xml = await response.text()
  const items = [...xml.matchAll(/<item[\s\S]*?<\/item>/gi)].map((match) => {
    const item = match[0]
    const get = (tag: string) => text(item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ''))
    return { title: get('title') ?? 'Noticia sin título', description: get('description'), source, ago: get('pubDate'), url: get('link') }
  })
  return { items, httpStatus: response.status }
}

const groqSchema = z.object({ watch: z.array(z.object({ category: z.string(), title: z.string(), detail: z.string(), importance: z.enum(['high', 'medium', 'low']) })).max(3) })
async function groqWatch(input: unknown) {
  if (!process.env.GROQ_API_KEY) return []
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.GROQ_API_KEY}` }, signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
    body: JSON.stringify({ model: process.env.GROQ_MODEL ?? 'openai/gpt-oss-20b', temperature: 0, response_format: { type: 'json_object' }, messages: [
      { role: 'system', content: 'Devuelve JSON con una única clave watch. Crea hasta 3 puntos basados exclusivamente en datos recibidos. No inventes valores, eventos, fechas ni niveles de importancia. Si falta evidencia suficiente para una señal accionable, exclúyela. Si no hay evidencia, devuelve watch vacío.' },
      { role: 'user', content: JSON.stringify(input) },
    ] }),
  })
  if (!response.ok) return []
  const json = await response.json()
  const parsed = groqSchema.safeParse(JSON.parse(json.choices?.[0]?.message?.content ?? '{}'))
  return parsed.success ? parsed.data.watch : []
}

const settled = async <T>(promise: Promise<T>, fallback: T) => promise.then((value) => value).catch(() => fallback)
const agoShort = (value: string | null) => { if (!value) return null; const ms = Date.now() - new Date(value).getTime(); if (!Number.isFinite(ms) || ms < 0) return null; const minutes = Math.floor(ms / 60000); return minutes < 60 ? `${Math.max(1, minutes)}m` : minutes < 1440 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1440)}d` }
const fearLabel = (value: number | null) => value == null ? null : value <= 24 ? 'Miedo extremo' : value <= 44 ? 'Miedo' : value <= 55 ? 'Neutral' : value <= 74 ? 'Codicia' : 'Codicia extrema'
const translationCache = new Map<string, string>()
const protectedTerms = ['Bitcoin', 'BTC', 'ETF', 'USDT', 'USD', 'Strategy', 'CoinDesk', 'Cointelegraph']
async function translateTitle(title: string) {
  const cached = translationCache.get(title); if (cached) return cached
  const source = title.trim(); if (!source) return source
  const tokens: string[] = []
  const masked = source.replace(new RegExp(`\\b(${protectedTerms.join('|')})\\b`, 'gi'), (term) => { tokens.push(term); return `XTERMZERO${tokens.length - 1}X` })
  try {
    const response = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(masked)}&langpair=en|es`, { signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS), next: { revalidate: 3600 } })
    const translated = text((await response.json().catch(() => ({})))?.responseData?.translatedText)
    const result = translated ? translated.replace(/XTERMZERO\\s*(\\d+)\\s*X/gi, (_, index) => tokens[Number(index)] ?? '').replace(/\\s+/g, ' ').trim() : source
    translationCache.set(title, result); return result
  } catch { return source }
}
async function translateNewsTitles<T extends { title: string }>(items: T[]) {
  return Promise.all(items.map(async (item) => ({ ...item, titleOriginal: item.title, title: await translateTitle(item.title) })))
}

export type LiveDebug = Record<string, unknown>

export async function collectLiveDaily(previous?: DailyData | null): Promise<{ data: DailyData; sources: Record<string, string>; debug: LiveDebug }> {
  const [market, global, fear, sentiment, etf, funding, openInterest, liquidations, coindesk, cointelegraph] = await Promise.all([
    settled(sourceJson('https://api.coingecko.com/api/v3/coins/bitcoin?localization=false&tickers=false&community_data=false&developer_data=false'), { json: {}, httpStatus: 0 }),
    settled(sourceJson('https://api.coingecko.com/api/v3/global'), { json: {}, httpStatus: 0 }),
    settled(sourceJson('https://api.alternative.me/fng/?limit=1'), { json: {}, httpStatus: 0 }),
    settled(sourceJson(`${XOOMAR_BASE}/markets/sentiment`), { json: {}, httpStatus: 0 }),
    settled(sourceJson(`${XOOMAR_BASE}/markets/etf-flows?asset=btc&days=90`), { json: {}, httpStatus: 0 }),
    settled(sourceJson(`${XOOMAR_BASE}/markets/funding-rates`), { json: {}, httpStatus: 0 }),
    settled(sourceJson(`${XOOMAR_BASE}/markets/open-interest/btc?period=1h`), { json: {}, httpStatus: 0 }),
    settled(sourceJson(`${XOOMAR_BASE}/markets/liquidations`), { json: {}, httpStatus: 0 }),
    settled(rss('https://www.coindesk.com/arc/outboundfeeds/rss/', 'CoinDesk'), { items: [], httpStatus: 0 }),
    settled(rss('https://cointelegraph.com/rss', 'Cointelegraph'), { items: [], httpStatus: 0 }),
  ])
  const coin = market.json as any; const globalJson = global.json as any; const fearJson = fear.json as any
  const sentimentRows = rowsOf((sentiment.json as any)?.data?.data ?? sentiment.json); const sentimentRow = sentimentRows.find((row) => row.slug === 'btc' && row.window === '24h')
  const score = toNumber(sentimentRow?.composite ?? sentimentRow?.compositeScore)
  const biasKey = score == null ? 'neutral' : score > 0.5 ? 'bullish' : score >= 0.1 ? 'moderately_bullish' : score >= -0.1 ? 'neutral' : score >= -0.5 ? 'moderately_bearish' : 'bearish'
  const biasLabel = { bullish: 'Alcista', moderately_bullish: 'Alcista moderado', neutral: 'Neutral', moderately_bearish: 'Bajista moderado', bearish: 'Bajista' }[biasKey]

  const etfRows = rowsOf(etf.json); const byDate = new Map<string, number>()
  for (const row of etfRows) { const flow = toNumber(row.flowUsd); if (flow != null && row.date) byDate.set(String(row.date), (byDate.get(String(row.date)) ?? 0) + flow) }
  const etfDays = [...byDate.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([, value]) => value)
  const days7 = etfDays.slice(0, 7).reduce((sum, value) => sum + value, 0); const days30 = etfDays.slice(0, 30).reduce((sum, value) => sum + value, 0); const previous30 = etfDays.slice(30, 60).reduce((sum, value) => sum + value, 0)
  const etfParsed = etfDays.length ? { lastDay: etfDays[0], days7, days30, change30d: previous30 !== 0 ? ((days30 - previous30) / Math.abs(previous30)) * 100 : null } : null

  const fundingRows = rowsOf(funding.json).filter((row) => row.slug === 'btc' || row.baseAsset === 'BTC'); const rates = fundingRows.map((row) => toNumber(row.fundingRate)).filter((value): value is number => value != null); const fundingParsed = rates.length ? rates.reduce((sum, value) => sum + value, 0) / rates.length * 100 : null
  const oiRows = rowsOf(openInterest.json).sort((a, b) => new Date(String(b.ts)).getTime() - new Date(String(a.ts)).getTime()); const latestTs = oiRows.find((row) => Number.isFinite(new Date(String(row.ts)).getTime()))?.ts; const latestRows = oiRows.filter((row) => String(row.ts) === String(latestTs)); const oiValues = latestRows.map((row) => toNumber(row.openInterestValue)).filter((value): value is number => value != null); const ratioRow = oiRows.find((row) => toNumber(row.longShortRatio) != null); const ratio = toNumber(ratioRow?.longShortRatio); const longPct = ratio == null ? null : ratio / (1 + ratio) * 100
  const liqData = (liquidations.json as any)?.data ?? {}; const liquidationsParsed = toNumber(liqData.totalUsd)

  const allNews = [...coindesk.items, ...cointelegraph.items].sort((a, b) => new Date(b.ago ?? 0).getTime() - new Date(a.ago ?? 0).getTime()); const btcNews = allNews.filter((item) => /bitcoin|btc|spot bitcoin etf|bitcoin etf/i.test(`${item.title} ${item.description ?? ''}`)); const news = await translateNewsTitles(btcNews.slice(0, 3).map(({ description: _description, ...item }) => ({ ...item, ago: agoShort(item.ago) })));
  const fearValue = toNumber(fearJson?.data?.[0]?.value); const watch = await settled(groqWatch({ market: coin.market_data, fearGreed: fearJson?.data?.[0], sentiment: sentimentRow, etf: etfParsed, funding: fundingParsed, openInterest: oiValues.reduce((sum, value) => sum + value, 0), liquidations: liquidationsParsed, news }), [])
  const current: DailyData = { asOf: new Date().toISOString(), market: { price: toNumber(coin.market_data?.current_price?.usd), change24h: toNumber(coin.market_data?.price_change_percentage_24h), marketCap: toNumber(coin.market_data?.market_cap?.usd), volume24h: toNumber(coin.market_data?.total_volume?.usd), dominance: toNumber(globalJson?.data?.market_cap_percentage?.btc), fearGreed: fearValue, fearGreedLabel: fearLabel(fearValue) }, catalyst: news[0] ?? null, bias: score == null ? null : { key: biasKey as any, label: biasLabel, news: toNumber(sentimentRow?.newsScore ?? sentimentRow?.newsLayer?.score)?.toFixed(2) ?? null, institutional: toNumber(sentimentRow?.institutionalScore ?? sentimentRow?.institutionalLayer?.score)?.toFixed(2) ?? null, traders: toNumber(sentimentRow?.crowdScore ?? sentimentRow?.crowdLayer?.score)?.toFixed(2) ?? null }, changes: previous ? [
      { id: 'price', label: 'Precio BTC', before: currentValue(previous.market.price), after: currentValue(coin.market_data?.current_price?.usd), direction: (toNumber(coin.market_data?.price_change_percentage_24h) ?? 0) > 0 ? 'positive' as const : (toNumber(coin.market_data?.price_change_percentage_24h) ?? 0) < 0 ? 'negative' as const : 'neutral' as const },
      ...(previous.market.fearGreed != null && fearValue != null && previous.market.fearGreed !== fearValue ? [{ id: 'fear-greed', label: 'Fear & Greed', before: String(previous.market.fearGreed), after: String(fearValue), direction: fearValue > previous.market.fearGreed ? 'positive' as const : 'negative' as const }] : []),
    ].slice(0, 3) : [], watch, etf: etfParsed, derivatives: { funding: fundingParsed, openInterest: oiValues.length ? oiValues.reduce((sum, value) => sum + value, 0) : null, longPct, shortPct: longPct == null ? null : 100 - longPct, liquidations24h: liquidationsParsed }, news }
  const debug: LiveDebug = { sentiment: { httpStatus: sentiment.httpStatus, rowCount: sentimentRows.length, btc24hFound: Boolean(sentimentRow), parsed: score != null }, etf: { httpStatus: etf.httpStatus, rowCount: etfRows.length, uniqueDates: byDate.size, parsed: Boolean(etfParsed) }, funding: { httpStatus: funding.httpStatus, rowCount: rowsOf(funding.json).length, btcRows: fundingRows.length, parsed: fundingParsed != null }, openInterest: { httpStatus: openInterest.httpStatus, rowCount: oiRows.length, latestTimestamp: latestTs ?? null, rowsAtLatestTimestamp: latestRows.length, parsed: oiValues.length > 0 }, liquidations: { httpStatus: liquidations.httpStatus, parsed: liquidationsParsed != null }, market: { dominanceParsed: current.market.dominance != null }, news: { parsedCount: allNews.length, bitcoinRelevantCount: btcNews.length, catalystTitle: news[0]?.title ?? null } }
  return { data: current, sources: { market: 'CoinGecko', fearGreed: 'Alternative.me', bias: 'Xoomar Sentiment', etf: 'Xoomar ETF Flows', funding: 'Xoomar Funding Rates', openInterest: 'Xoomar Open Interest', liquidations: 'Xoomar Liquidations', catalyst: news[0]?.source ?? 'RSS no disponible', news: news.length ? 'RSS filtrado BTC' : 'RSS no disponible', watch: watch.length ? 'Groq' : 'Groq sin señales' }, debug }
}
function currentValue(value: unknown) { const parsed = toNumber(value); return parsed == null ? 'Sin datos' : String(parsed) }
