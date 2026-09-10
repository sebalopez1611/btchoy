import { z } from 'zod'
import type { DailyData } from '@/lib/daily-types'

const XOOMAR_BASE = 'https://xoomar.com/api'
const SOURCE_TIMEOUT_MS = 7000
const BIAS_MAX_AGE_MS = 36 * 60 * 60 * 1000
const HISTORY_MAX_AGE_MS = 36 * 60 * 60 * 1000

export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(typeof value === 'string' ? value.replace(/[$,%\s,]/g, '') : value)
  return Number.isFinite(n) ? n : null
}

const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null
const money = (value: number) => `$${Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
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
    const mediaTag = item.match(/<(?:media:content|media:thumbnail|enclosure)\b[^>]*>/i)?.[0] ?? ''
    const mediaUrl = mediaTag.match(/\burl=["']([^"']+)["']/i)?.[1] ?? null
    const mediaType = mediaTag.match(/\btype=["']([^"']+)["']/i)?.[1]?.toLowerCase() ?? ''
    const imageUrl = mediaUrl && (mediaType.startsWith('image/') || /\.(?:jpe?g|png|webp)(?:[?#].*)?$/i.test(mediaUrl)) ? mediaUrl : null
    return { title: get('title') ?? 'Noticia sin título', description: get('description'), source, ago: get('pubDate'), url: get('link'), imageUrl }
  })
  return { items, httpStatus: response.status }
}

const groqSchema = z.object({ watch: z.array(z.object({ category: z.string(), title: z.string(), detail: z.string(), importance: z.enum(['high', 'medium', 'low']) })).max(3) })
function deterministicWatch(data: { market: any; etf: any; bias: any; fearGreed: any; funding: any; liquidations: any }) {
  const items = []
  if (data.market?.change24h != null) items.push({ category: 'Bitcoin', title: 'Bitcoin se mueve en 24 horas', detail: `El precio cambió ${Number(data.market.change24h).toFixed(2)}% y marca el tono general del mercado.`, importance: Math.abs(Number(data.market.change24h)) >= 3 ? 'high' as const : 'medium' as const })
  if (data.etf?.lastDay != null) items.push({ category: 'ETF', title: `Los ETF ${data.etf.lastDay >= 0 ? 'siguen recibiendo dinero' : 'están registrando salidas'}`, detail: `La demanda de estos fondos puede ayudar a sostener o presionar el precio de Bitcoin.`, importance: 'high' as const })
  if (data.bias) items.push({ category: 'Mercado', title: `Los grandes inversores están ${data.bias.label?.includes('baj') ? 'más cautos' : 'más optimistas'}`, detail: 'Su comportamiento muestra cómo ven el mercado quienes mueven más dinero.', importance: 'medium' as const })
  if (data.fearGreed != null) items.push({ category: 'Mercado', title: `El mercado está ${Number(data.fearGreed) >= 75 ? 'muy optimista' : Number(data.fearGreed) <= 25 ? 'muy preocupado' : 'moderado'}`, detail: `El índice está en ${data.fearGreed} y ayuda a entender el ánimo general de los inversores.`, importance: 'medium' as const })
  if (data.funding != null) items.push({ category: 'Traders', title: 'Hay más traders apostando a una subida', detail: `La tasa actual indica que hay más interés por mantener posiciones que esperan una subida.`, importance: 'low' as const })
  if (data.liquidations != null) items.push({ category: 'Traders', title: 'Muchos traders fueron liquidados', detail: `En las últimas 24 horas se liquidaron ${money(data.liquidations)} en posiciones.`, importance: 'low' as const })
  return items.slice(0, 3)
}

const groqPrompt = 'Eres el editor de Bitcoin Hoy.\n\nTu trabajo es explicar las 3 cosas más importantes que una persona común debería vigilar hoy en Bitcoin.\n\nTu lector no es necesariamente trader ni experto en finanzas. Debe poder entender todo rápidamente. Usa exclusivamente los datos proporcionados. No inventes cifras, noticias, eventos ni fechas. No recomiendes comprar ni vender.\n\nPrioriza claridad, utilidad, impacto real en Bitcoin y lenguaje sencillo. Cada tarjeta debe responder mentalmente: ¿qué está pasando? y ¿por qué importa?\n\nEvita jerga técnica siempre que exista una forma más simple de decirlo. No uses términos como retail, divergencia, posicionamiento, apalancamiento, risk-on, risk-off, convexidad, liquidez marginal o estructura de mercado a menos que los expliques en lenguaje común.\n\nNo elijas automáticamente BTC, ETF o Sesgo. Elige sólo lo más interesante según los datos actuales.\n\nDevuelve exclusivamente JSON con esta forma: {"watch":[{"category":"...","title":"...","detail":"...","importance":"high|medium|low"}]}. Máximo 3; idealmente exactamente 3 si existen suficientes datos. category máximo 3 palabras. title máximo 60 caracteres y fácil de entender. detail máximo 120 caracteres y debe explicar por qué importa. Idioma español natural. Tono como un buen periodista financiero explicándole Bitcoin a una persona inteligente pero no experta: profesional, directo, no infantil, no técnico y no sensacionalista. Devuelve solamente JSON válido.'

async function groqWatch(input: unknown) {
  if (!process.env.GROQ_API_KEY) return { httpStatus: null, items: [] as z.infer<typeof groqSchema>['watch'] }
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.GROQ_API_KEY}` }, signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
      body: JSON.stringify({ model: process.env.GROQ_MODEL ?? 'openai/gpt-oss-20b', temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: groqPrompt }, { role: 'user', content: JSON.stringify(input) }] }),
    })
    const json = await response.json().catch(() => ({}))
    const parsed = groqSchema.safeParse(JSON.parse(json.choices?.[0]?.message?.content ?? '{}'))
    return { httpStatus: response.status, items: parsed.success ? parsed.data.watch : [] }
  } catch { return { httpStatus: null, items: [] as z.infer<typeof groqSchema>['watch'] } }
}

const settled = async <T>(promise: Promise<T>, fallback: T) => promise.then((value) => value).catch(() => fallback)
const agoShort = (value: string | null) => { if (!value) return null; const ms = Date.now() - new Date(value).getTime(); if (!Number.isFinite(ms) || ms < 0) return null; const minutes = Math.floor(ms / 60000); return minutes < 60 ? `${Math.max(1, minutes)}m` : minutes < 1440 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1440)}d` }
const fearLabel = (value: number | null) => value == null ? null : value <= 24 ? 'Miedo extremo' : value <= 44 ? 'Miedo' : value <= 55 ? 'Neutral' : value <= 74 ? 'Codicia' : 'Codicia extrema'
const scoreLabel = (value: number | null, kind: 'news' | 'institutional' | 'crowd') => { if (value == null) return 'Sin datos'; if (kind === 'news') return value >= .30 ? 'Positivas' : value >= .10 ? 'Levemente positivas' : value > -.10 ? 'Neutrales' : value > -.30 ? 'Levemente negativas' : 'Negativas'; return value >= .50 ? 'Muy alcistas' : value >= .20 ? 'Alcistas' : value > -.20 ? 'Neutrales' : value > -.50 ? 'Bajistas' : 'Muy bajistas' }
const translationCache = new Map<string, string>()
const protectedTerms = ['Bitcoin', 'BTC', 'ETF', 'ETFs', 'BlackRock', 'Fed', 'SEC', 'Coinbase', 'MicroStrategy', 'Strategy', 'IBIT', 'FBTC', 'ARKB', 'Open Interest', 'Funding Rate', 'Funding', 'HODL', 'DeFi', 'CeFi', 'NASDAQ', 'NYSE', 'DXY', 'CPI', 'PPI', 'PCE', 'FOMC', 'Federal Reserve', 'Bank of Japan', 'Bank of England', 'Bank of America', 'Bank of Canada', 'European Central Bank', 'World Bank', 'Deutsche Bank', 'Goldman Sachs', 'JPMorgan', 'Morgan Stanley', 'Standard Chartered', 'Grayscale', 'VanEck', 'Fidelity', 'Ark Invest', 'Bitwise', 'Binance', 'Kraken', 'Tether', 'Circle', 'Ripple', 'Ethereum', 'CME', 'Wall Street', 'CoinDesk', 'Cointelegraph', 'USD', 'USDT']
async function translateTitle(title: string) {
  const cached = translationCache.get(title); if (cached) return cached
  const source = title.trim(); if (!source) return source
  const tokens: string[] = []
  const masked = source.replace(new RegExp(`\\b(${protectedTerms.join('|')})\\b`, 'gi'), (term) => { tokens.push(term); return `XTERMZERO${tokens.length - 1}X` })
  try {
    const response = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(masked)}&langpair=en|es`, { signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS), next: { revalidate: 3600 } })
    const translated = text((await response.json().catch(() => ({})))?.responseData?.translatedText)
    let result = translated ? translated.replace(/XTERMZERO\s*(\d+)\s*X/gi, (_, index) => tokens[Number(index)] ?? '').replace(/\s+/g, ' ').trim() : source
    if (/XTERMZERO/i.test(result)) result = result.replace(/XTERMZERO\s*(\d+)\s*X/gi, (_, index) => tokens[Number(index)] ?? '').trim()
    if (/XTERMZERO/i.test(result)) result = source
    translationCache.set(title, result); return result
  } catch { return source }
}
async function translateNewsTitles<T extends { title: string }>(items: T[]) {
  return Promise.all(items.map(async (item) => ({ ...item, titleOriginal: item.title, title: await translateTitle(item.title) })))
}

export type LiveDebug = Record<string, unknown>

export async function collectLiveDaily(previous?: DailyData | null, lastKnownGood?: DailyData | null): Promise<{ data: DailyData; sources: Record<string, string>; debug: LiveDebug }> {
  const [market, global, marketHistory, fear, fearHistory, sentiment, signals, etf, funding, openInterest, liquidations, coindesk, cointelegraph] = await Promise.all([
    settled(sourceJson('https://api.coingecko.com/api/v3/coins/bitcoin?localization=false&tickers=false&community_data=false&developer_data=false'), { json: {}, httpStatus: 0 }),
    settled(sourceJson('https://api.coingecko.com/api/v3/global'), { json: {}, httpStatus: 0 }),
    settled(sourceJson('https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=1&interval=hourly'), { json: {}, httpStatus: 0 }),
    settled(sourceJson('https://api.alternative.me/fng/?limit=1'), { json: {}, httpStatus: 0 }),
    settled(sourceJson('https://api.alternative.me/fng/?limit=14'), { json: {}, httpStatus: 0 }),
    settled(sourceJson(`${XOOMAR_BASE}/markets/sentiment?asset=btc&window=24h`), { json: {}, httpStatus: 0 }),
    settled(sourceJson(`${XOOMAR_BASE}/markets/signals/btc`), { json: {}, httpStatus: 0 }),
    settled(sourceJson(`${XOOMAR_BASE}/markets/etf-flows?asset=btc&days=90`), { json: {}, httpStatus: 0 }),
    settled(sourceJson(`${XOOMAR_BASE}/markets/funding-rates`), { json: {}, httpStatus: 0 }),
    settled(sourceJson(`${XOOMAR_BASE}/markets/open-interest/btc?period=1h`), { json: {}, httpStatus: 0 }),
    settled(sourceJson(`${XOOMAR_BASE}/markets/liquidations`), { json: {}, httpStatus: 0 }),
    settled(rss('https://www.coindesk.com/arc/outboundfeeds/rss/', 'CoinDesk'), { items: [], httpStatus: 0 }),
    settled(rss('https://cointelegraph.com/rss', 'Cointelegraph'), { items: [], httpStatus: 0 }),
  ])
  const coin = market.json as any; const globalJson = global.json as any; const fearJson = fear.json as any
  const chartJson = marketHistory.json as any
  const downsample = (values: number[], max = 24) => { if (values.length <= max) return values; const step = (values.length - 1) / (max - 1); return Array.from({ length: max }, (_, index) => values[Math.round(index * step)]).filter((value): value is number => value != null) }
  const isFresh = (asOf: string | null | undefined, maxAge: number) => { const timestamp = asOf ? new Date(asOf).getTime() : NaN; return Number.isFinite(timestamp) && Date.now() - timestamp <= maxAge }
  const previousHistory = previous?.market.history
  const historyFallback = (values: number[] | undefined, asOf: string | null | undefined) => isFresh(asOf, HISTORY_MAX_AGE_MS) && values?.length ? values : []
  const marketCapHistory = downsample((chartJson.market_caps ?? []).map((point: unknown[]) => toNumber(point?.[1])).filter((value: number | null): value is number => value != null))
  const volumeHistory = downsample((chartJson.total_volumes ?? []).map((point: unknown[]) => toNumber(point?.[1])).filter((value: number | null): value is number => value != null))
  const preservedMarketCapHistory = marketCapHistory.length >= 2 ? marketCapHistory : historyFallback(previousHistory?.marketCap, previous?.asOf)
  const preservedVolumeHistory = volumeHistory.length >= 2 ? volumeHistory : historyFallback(previousHistory?.volume24h, previous?.asOf)
  const fearHistoryValues = downsample(((fearHistory.json as any)?.data ?? []).map((row: any) => toNumber(row.value)).filter((value: number | null): value is number => value != null), 14)
  const sentimentRows = rowsOf((sentiment.json as any)?.data?.data ?? sentiment.json); const sentimentRow = sentimentRows.find((row) => (row.slug === 'btc' || row.symbol === 'btc') && row.window === '24h')
  const signalData = (signals.json as any)?.data ?? {}
  const score = toNumber(sentimentRow?.composite ?? sentimentRow?.compositeScore) ?? toNumber(signalData.composite)
  const biasKey = score == null ? 'neutral' : score >= 0.30 ? 'bullish' : score >= 0.15 ? 'moderately_bullish' : score > -0.15 ? 'neutral' : score > -0.30 ? 'moderately_bearish' : 'bearish'
  const biasLabel = { bullish: 'Alcista', moderately_bullish: 'Alcista moderado', neutral: 'Neutral', moderately_bearish: 'Bajista moderado', bearish: 'Bajista' }[biasKey]
  const liveBiasScoresValid = score != null && sentiment.httpStatus >= 200 && sentiment.httpStatus < 300 && Boolean(sentimentRow || signalData.composite != null)
  const preservedBias = !liveBiasScoresValid && lastKnownGood?.bias && isFresh(lastKnownGood.bias.asOf ?? lastKnownGood.asOf, BIAS_MAX_AGE_MS) ? { ...lastKnownGood.bias, stale: true } : null

  const etfRows = rowsOf(etf.json); const byDate = new Map<string, { totalFlow: number; validFlowCount: number; rowCount: number }>()
  for (const row of etfRows) { const rawDate = row.date ? String(row.date).slice(0, 10) : null; if (!rawDate) continue; const current = byDate.get(rawDate) ?? { totalFlow: 0, validFlowCount: 0, rowCount: 0 }; current.rowCount += 1; const flow = toNumber(row.flowUsd); if (flow != null) { current.totalFlow += flow; current.validFlowCount += 1 } byDate.set(rawDate, current) }
  const todayNY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const dateStats = [...byDate.entries()].map(([date, stats]) => ({ date, ...stats })).sort((a, b) => b.date.localeCompare(a.date))
  const historicalCandidates = dateStats.filter((entry) => entry.date < todayNY && entry.validFlowCount > 0)
  const rowCounts = historicalCandidates.map((entry) => entry.rowCount).sort((a, b) => a - b)
  const medianRowCount = rowCounts.length ? rowCounts[Math.floor(rowCounts.length / 2)] : 0
  const expectedRowCount = Math.max(1, medianRowCount)
  const completeDays = historicalCandidates.map((entry) => ({ ...entry, complete: entry.validFlowCount >= expectedRowCount * 0.7 })).filter((entry) => entry.complete)
  const latestPublished = completeDays[0] ?? null
  const publishedValues = completeDays.map((entry) => entry.totalFlow)
  const latestPublishedDate = latestPublished?.date ?? null
  const latestStats = latestPublished
  const days7 = publishedValues.slice(0, 7).reduce((sum, value) => sum + value, 0); const days30 = publishedValues.slice(0, 30).reduce((sum, value) => sum + value, 0); const previous30 = publishedValues.slice(30, 60).reduce((sum, value) => sum + value, 0)
  const etfParsed = latestPublished ? { lastDay: latestPublished.totalFlow, lastDayDate: latestPublished.date, days7, days30, change30d: previous30 !== 0 ? ((days30 - previous30) / Math.abs(previous30)) * 100 : null } : null

  const fundingRows = rowsOf(funding.json).filter((row) => row.slug === 'btc' || row.baseAsset === 'BTC'); const rates = fundingRows.map((row) => toNumber(row.fundingRate)).filter((value): value is number => value != null); const fundingParsed = rates.length ? rates.reduce((sum, value) => sum + value, 0) / rates.length * 100 : null
  const oiRows = rowsOf(openInterest.json).sort((a, b) => new Date(String(b.ts)).getTime() - new Date(String(a.ts)).getTime()); const latestTs = oiRows.find((row) => Number.isFinite(new Date(String(row.ts)).getTime()))?.ts; const latestRows = oiRows.filter((row) => String(row.ts) === String(latestTs)); const oiValues = latestRows.map((row) => toNumber(row.openInterestValue)).filter((value): value is number => value != null); const ratioRow = oiRows.find((row) => toNumber(row.longShortRatio) != null); const ratio = toNumber(ratioRow?.longShortRatio); const longPct = ratio == null ? null : ratio / (1 + ratio) * 100
  const liqData = (liquidations.json as any)?.data ?? {}; const liquidationsParsed = toNumber(liqData.totalUsd)

  const allNews = [...coindesk.items, ...cointelegraph.items].sort((a, b) => new Date(b.ago ?? 0).getTime() - new Date(a.ago ?? 0).getTime()); const btcNews = allNews.filter((item) => /bitcoin|btc|spot bitcoin etf|bitcoin etf/i.test(`${item.title} ${item.description ?? ''}`)); const news = await translateNewsTitles(btcNews.slice(0, 3).map(({ description: _description, ...item }) => ({ ...item, ago: agoShort(item.ago) })));
  const fearValue = toNumber(fearJson?.data?.[0]?.value)
  const normalizedMarket = { price: toNumber(coin.market_data?.current_price?.usd) ?? lastKnownGood?.market.price ?? null, change24h: toNumber(coin.market_data?.price_change_percentage_24h) ?? lastKnownGood?.market.change24h ?? null, marketCap: toNumber(coin.market_data?.market_cap?.usd) ?? lastKnownGood?.market.marketCap ?? null, volume24h: toNumber(coin.market_data?.total_volume?.usd) ?? lastKnownGood?.market.volume24h ?? null, dominance: toNumber(globalJson?.data?.market_cap_percentage?.btc) ?? lastKnownGood?.market.dominance ?? null, fearGreed: fearValue ?? lastKnownGood?.market.fearGreed ?? null, fearGreedLabel: fearLabel(fearValue ?? lastKnownGood?.market.fearGreed ?? null) }
  const normalizedBias = liveBiasScoresValid ? { key: biasKey as any, label: biasLabel, news: scoreLabel(toNumber(sentimentRow?.newsScore ?? sentimentRow?.newsLayer?.score ?? signalData.news?.score), 'news'), institutional: scoreLabel(toNumber(sentimentRow?.institutionalScore ?? sentimentRow?.institutionalLayer?.score ?? signalData.institutional?.score), 'institutional'), traders: scoreLabel(toNumber(sentimentRow?.crowdScore ?? sentimentRow?.crowdLayer?.score ?? signalData.crowd?.score), 'crowd'), asOf: new Date().toISOString(), stale: false } : preservedBias
  const normalizedDerivatives = { funding: fundingParsed ?? lastKnownGood?.derivatives?.funding ?? null, openInterest: oiValues.length ? oiValues.reduce((sum, value) => sum + value, 0) : lastKnownGood?.derivatives?.openInterest ?? null, longPct: longPct ?? lastKnownGood?.derivatives?.longPct ?? null, shortPct: longPct == null ? lastKnownGood?.derivatives?.shortPct ?? null : 100 - longPct, liquidations24h: liquidationsParsed ?? lastKnownGood?.derivatives?.liquidations24h ?? null }
  const watchInput = { market: normalizedMarket, bias: normalizedBias, etf: etfParsed ?? lastKnownGood?.etf ?? null, derivatives: normalizedDerivatives, changes: previous?.changes ?? [], catalyst: news[0] ?? null, news: news.map(({ title, source, ago, url }) => ({ title, source, ago, url })) }
  const groqResponse = await groqWatch(watchInput)
  const groqItems = groqResponse.items
  const fallbackItems = deterministicWatch({ market: normalizedMarket, etf: watchInput.etf, bias: normalizedBias, fearGreed: fearValue, funding: normalizedDerivatives.funding, liquidations: normalizedDerivatives.liquidations24h })
  const fallbackItemsUsed = Math.max(0, 3 - groqItems.length)
  const watch = [...groqItems, ...fallbackItems.filter((fallback) => !groqItems.some((item) => item.category.trim().toLowerCase() === fallback.category.trim().toLowerCase())).slice(0, fallbackItemsUsed)].slice(0, 3)
  const current: DailyData = { asOf: new Date().toISOString(), market: { price: toNumber(coin.market_data?.current_price?.usd) ?? lastKnownGood?.market.price ?? null, change24h: toNumber(coin.market_data?.price_change_percentage_24h) ?? lastKnownGood?.market.change24h ?? null, marketCap: toNumber(coin.market_data?.market_cap?.usd) ?? lastKnownGood?.market.marketCap ?? null, volume24h: toNumber(coin.market_data?.total_volume?.usd) ?? lastKnownGood?.market.volume24h ?? null, dominance: toNumber(globalJson?.data?.market_cap_percentage?.btc) ?? lastKnownGood?.market.dominance ?? null, fearGreed: fearValue ?? lastKnownGood?.market.fearGreed ?? null, fearGreedLabel: fearLabel(fearValue ?? lastKnownGood?.market.fearGreed ?? null), history: { marketCap: preservedMarketCapHistory, volume24h: preservedVolumeHistory, dominance: [lastKnownGood?.market.history?.dominance ?? [], toNumber(globalJson?.data?.market_cap_percentage?.btc)].flat().filter((value): value is number => value != null).slice(-24), fearGreed: fearHistoryValues.length >= 2 ? fearHistoryValues : historyFallback(previousHistory?.fearGreed, previous?.asOf) } }, catalyst: news[0] ?? null, bias: normalizedBias, changes: previous ? [
      { id: 'price', label: 'Precio BTC', before: currentValue(previous.market.price), after: currentValue(normalizedMarket.price), direction: (toNumber(coin.market_data?.price_change_percentage_24h) ?? 0) > 0 ? 'positive' as const : (toNumber(coin.market_data?.price_change_percentage_24h) ?? 0) < 0 ? 'negative' as const : 'neutral' as const },
      ...(previous.market.fearGreed != null && fearValue != null && previous.market.fearGreed !== fearValue ? [{ id: 'fear-greed', label: 'Fear & Greed', before: String(previous.market.fearGreed), after: String(fearValue), direction: fearValue > previous.market.fearGreed ? 'positive' as const : 'negative' as const }] : []),
    ].slice(0, 3) : [], watch, etf: etfParsed ?? lastKnownGood?.etf ?? null, derivatives: { funding: fundingParsed ?? lastKnownGood?.derivatives?.funding ?? null, openInterest: oiValues.length ? oiValues.reduce((sum, value) => sum + value, 0) : lastKnownGood?.derivatives?.openInterest ?? null, longPct: longPct ?? lastKnownGood?.derivatives?.longPct ?? null, shortPct: longPct == null ? lastKnownGood?.derivatives?.shortPct ?? null : 100 - longPct, liquidations24h: liquidationsParsed ?? lastKnownGood?.derivatives?.liquidations24h ?? null }, news }
  const debug: LiveDebug = { watch: { groqHttpStatus: groqResponse.httpStatus, groqParsedCount: groqItems.length, groqItems, fallbackItemsUsed, finalItems: watch }, sentiment: { httpStatus: sentiment.httpStatus, rowCount: sentimentRows.length, btc24hFound: Boolean(sentimentRow), parsed: score != null }, etf: { httpStatus: etf.httpStatus, todayNY, rawRowCount: etfRows.length, dates: dateStats.slice(0, 5).map((entry) => ({ date: entry.date, totalFlow: entry.totalFlow, rowCount: entry.rowCount, validFlowCount: entry.validFlowCount, complete: entry.date < todayNY && entry.validFlowCount > 0 && entry.validFlowCount >= expectedRowCount * 0.7 })), expectedRowCount, latestPublishedDate, lastDay: etfParsed?.lastDay ?? null }, funding: { httpStatus: funding.httpStatus, rowCount: rowsOf(funding.json).length, btcRows: fundingRows.length, parsed: fundingParsed != null }, openInterest: { httpStatus: openInterest.httpStatus, rowCount: oiRows.length, latestTimestamp: latestTs ?? null, rowsAtLatestTimestamp: latestRows.length, parsed: oiValues.length > 0 }, liquidations: { httpStatus: liquidations.httpStatus, parsed: liquidationsParsed != null }, market: { httpStatus: market.httpStatus, globalHttpStatus: global.httpStatus, usedStaleFallback: Boolean(lastKnownGood && (toNumber(coin.market_data?.current_price?.usd) == null || toNumber(coin.market_data?.market_cap?.usd) == null)), priceParsed: current.market.price != null, marketCapParsed: current.market.marketCap != null, volumeParsed: current.market.volume24h != null, dominanceParsed: current.market.dominance != null }, news: { parsedCount: allNews.length, bitcoinRelevantCount: btcNews.length, catalystTitle: news[0]?.title ?? null } }
  return { data: current, sources: { market: 'CoinGecko', fearGreed: 'Alternative.me', bias: 'Xoomar Sentiment', etf: 'Xoomar ETF Flows', funding: 'Xoomar Funding Rates', openInterest: 'Xoomar Open Interest', liquidations: 'Xoomar Liquidations', catalyst: news[0]?.source ?? 'RSS no disponible', news: news.length ? 'RSS filtrado BTC' : 'RSS no disponible', watch: watch.length ? 'Groq' : 'Groq sin señales' }, debug }
}
function currentValue(value: unknown) { const parsed = toNumber(value); return parsed == null ? 'Sin datos' : String(parsed) }
