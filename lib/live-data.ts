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
  if (data.market?.change24h != null) items.push({ category: 'BTC', title: 'Variación de Bitcoin en 24h', detail: `El precio registra ${Number(data.market.change24h).toFixed(2)}% en las últimas 24 horas.`, importance: Math.abs(Number(data.market.change24h)) >= 3 ? 'high' as const : 'medium' as const })
  if (data.etf?.lastDay != null) items.push({ category: 'ETF', title: 'Flujos del último día', detail: `Los ETF Spot registran ${data.etf.lastDay >= 0 ? 'entradas' : 'salidas'} por ${money(data.etf.lastDay)}.`, importance: 'high' as const })
  if (data.bias) items.push({ category: 'Sesgo', title: `Sesgo ${data.bias.label}`, detail: 'La lectura editorial combina sentimiento, posicionamiento e información institucional.', importance: 'medium' as const })
  if (data.fearGreed != null) items.push({ category: 'Fear & Greed', title: `Índice en ${data.fearGreed}`, detail: 'El nivel actual contextualiza el apetito de riesgo del mercado.', importance: 'medium' as const })
  if (data.funding != null) items.push({ category: 'Funding', title: 'Funding rate disponible', detail: `La tasa agregada se sitúa en ${Number(data.funding).toFixed(4)}%.`, importance: 'low' as const })
  if (data.liquidations != null) items.push({ category: 'Liquidaciones', title: 'Liquidaciones de 24h', detail: `Se registran ${money(data.liquidations)} en liquidaciones.`, importance: 'low' as const })
  return items.slice(0, 3)
}

async function groqWatch(input: unknown) {
  if (!process.env.GROQ_API_KEY) return []
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.GROQ_API_KEY}` }, signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
    body: JSON.stringify({ model: process.env.GROQ_MODEL ?? 'openai/gpt-oss-20b', temperature: 0, response_format: { type: 'json_object' }, messages: [
      { role: 'system', content: 'Eres el editor diario de Bitcoin Hoy. Revisa TODOS los datos normalizados y selecciona las 3 observaciones más relevantes que un lector debería vigilar hoy. No eres un generador de señales de trading: no recomiendes comprar ni vender, y no inventes cifras, eventos, noticias ni fechas. Analiza relaciones, cambios, extremos y divergencias. No elijas automáticamente BTC, ETF y Sesgo. Puedes detectar Fear & Greed extremo mientras el precio cae, divergencias ETF/precio, funding elevado, aumento de Open Interest, liquidaciones altas, divergencias entre institucionales y traders, cambios de Sesgo, catalizadores, dominancia o volumen. Devuelve exactamente {"watch":[{"category":"...","title":"...","detail":"...","importance":"high|medium|low"}]}. Máximo 3; idealmente 3 si hay datos suficientes. title máximo 55 caracteres y detail máximo 110. Idioma español, tono profesional, editorial y directo. Devuelve solamente JSON válido.' },
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
  const marketCapHistory = downsample((chartJson.market_caps ?? []).map((point: unknown[]) => toNumber(point?.[1])).filter((value: number | null): value is number => value != null))
  const volumeHistory = downsample((chartJson.total_volumes ?? []).map((point: unknown[]) => toNumber(point?.[1])).filter((value: number | null): value is number => value != null))
  const fearHistoryValues = downsample(((fearHistory.json as any)?.data ?? []).map((row: any) => toNumber(row.value)).filter((value: number | null): value is number => value != null), 14)
  const sentimentRows = rowsOf((sentiment.json as any)?.data?.data ?? sentiment.json); const sentimentRow = sentimentRows.find((row) => (row.slug === 'btc' || row.symbol === 'btc') && row.window === '24h')
  const signalData = (signals.json as any)?.data ?? {}
  const score = toNumber(sentimentRow?.composite ?? sentimentRow?.compositeScore) ?? toNumber(signalData.composite)
  const biasKey = score == null ? 'neutral' : score >= 0.30 ? 'bullish' : score >= 0.15 ? 'moderately_bullish' : score > -0.15 ? 'neutral' : score > -0.30 ? 'moderately_bearish' : 'bearish'
  const biasLabel = { bullish: 'Alcista', moderately_bullish: 'Alcista moderado', neutral: 'Neutral', moderately_bearish: 'Bajista moderado', bearish: 'Bajista' }[biasKey]

  const etfRows = rowsOf(etf.json); const byDate = new Map<string, number>()
  for (const row of etfRows) { const flow = toNumber(row.flowUsd); const rawDate = row.date ? String(row.date).slice(0, 10) : null; if (flow != null && rawDate) byDate.set(rawDate, (byDate.get(rawDate) ?? 0) + flow) }
  const todayNY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const publishedDays = [...byDate.entries()].filter(([date]) => date < todayNY).sort(([a], [b]) => b.localeCompare(a))
  const publishedValues = publishedDays.map(([, value]) => value)
  const latestPublishedDate = publishedDays[0]?.[0] ?? null
  const days7 = publishedValues.slice(0, 7).reduce((sum, value) => sum + value, 0); const days30 = publishedValues.slice(0, 30).reduce((sum, value) => sum + value, 0); const previous30 = publishedValues.slice(30, 60).reduce((sum, value) => sum + value, 0)
  const etfParsed = latestPublishedDate ? { lastDay: byDate.get(latestPublishedDate) ?? null, lastDayDate: latestPublishedDate, days7, days30, change30d: previous30 !== 0 ? ((days30 - previous30) / Math.abs(previous30)) * 100 : null } : null

  const fundingRows = rowsOf(funding.json).filter((row) => row.slug === 'btc' || row.baseAsset === 'BTC'); const rates = fundingRows.map((row) => toNumber(row.fundingRate)).filter((value): value is number => value != null); const fundingParsed = rates.length ? rates.reduce((sum, value) => sum + value, 0) / rates.length * 100 : null
  const oiRows = rowsOf(openInterest.json).sort((a, b) => new Date(String(b.ts)).getTime() - new Date(String(a.ts)).getTime()); const latestTs = oiRows.find((row) => Number.isFinite(new Date(String(row.ts)).getTime()))?.ts; const latestRows = oiRows.filter((row) => String(row.ts) === String(latestTs)); const oiValues = latestRows.map((row) => toNumber(row.openInterestValue)).filter((value): value is number => value != null); const ratioRow = oiRows.find((row) => toNumber(row.longShortRatio) != null); const ratio = toNumber(ratioRow?.longShortRatio); const longPct = ratio == null ? null : ratio / (1 + ratio) * 100
  const liqData = (liquidations.json as any)?.data ?? {}; const liquidationsParsed = toNumber(liqData.totalUsd)

  const allNews = [...coindesk.items, ...cointelegraph.items].sort((a, b) => new Date(b.ago ?? 0).getTime() - new Date(a.ago ?? 0).getTime()); const btcNews = allNews.filter((item) => /bitcoin|btc|spot bitcoin etf|bitcoin etf/i.test(`${item.title} ${item.description ?? ''}`)); const news = await translateNewsTitles(btcNews.slice(0, 3).map(({ description: _description, ...item }) => ({ ...item, ago: agoShort(item.ago) })));
  const fearValue = toNumber(fearJson?.data?.[0]?.value)
  const normalizedMarket = { price: toNumber(coin.market_data?.current_price?.usd) ?? lastKnownGood?.market.price ?? null, change24h: toNumber(coin.market_data?.price_change_percentage_24h) ?? lastKnownGood?.market.change24h ?? null, marketCap: toNumber(coin.market_data?.market_cap?.usd) ?? lastKnownGood?.market.marketCap ?? null, volume24h: toNumber(coin.market_data?.total_volume?.usd) ?? lastKnownGood?.market.volume24h ?? null, dominance: toNumber(globalJson?.data?.market_cap_percentage?.btc) ?? lastKnownGood?.market.dominance ?? null, fearGreed: fearValue ?? lastKnownGood?.market.fearGreed ?? null, fearGreedLabel: fearLabel(fearValue ?? lastKnownGood?.market.fearGreed ?? null) }
  const normalizedBias = score == null ? null : { label: biasLabel, news: scoreLabel(toNumber(sentimentRow?.newsScore ?? sentimentRow?.newsLayer?.score ?? signalData.news?.score), 'news'), institutional: scoreLabel(toNumber(sentimentRow?.institutionalScore ?? sentimentRow?.institutionalLayer?.score ?? signalData.institutional?.score), 'institutional'), traders: scoreLabel(toNumber(sentimentRow?.crowdScore ?? sentimentRow?.crowdLayer?.score ?? signalData.crowd?.score), 'crowd') }
  const normalizedDerivatives = { funding: fundingParsed ?? lastKnownGood?.derivatives?.funding ?? null, openInterest: oiValues.length ? oiValues.reduce((sum, value) => sum + value, 0) : lastKnownGood?.derivatives?.openInterest ?? null, longPct: longPct ?? lastKnownGood?.derivatives?.longPct ?? null, shortPct: longPct == null ? lastKnownGood?.derivatives?.shortPct ?? null : 100 - longPct, liquidations24h: liquidationsParsed ?? lastKnownGood?.derivatives?.liquidations24h ?? null }
  const watchInput = { market: normalizedMarket, bias: normalizedBias, etf: etfParsed ?? lastKnownGood?.etf ?? null, derivatives: normalizedDerivatives, changes: previous?.changes ?? [], catalyst: news[0] ?? null, news: news.map(({ title, source, ago, url }) => ({ title, source, ago, url })) }
  const groqResult = await settled(groqWatch(watchInput), [])
  const fallbackItems = deterministicWatch({ market: normalizedMarket, etf: watchInput.etf, bias: normalizedBias, fearGreed: fearValue, funding: normalizedDerivatives.funding, liquidations: normalizedDerivatives.liquidations24h })
  const watch = [...groqResult, ...fallbackItems.filter((fallback) => !groqResult.some((item) => item.category.trim().toLowerCase() === fallback.category.trim().toLowerCase()))].slice(0, 3)
  const current: DailyData = { asOf: new Date().toISOString(), market: { price: toNumber(coin.market_data?.current_price?.usd) ?? lastKnownGood?.market.price ?? null, change24h: toNumber(coin.market_data?.price_change_percentage_24h) ?? lastKnownGood?.market.change24h ?? null, marketCap: toNumber(coin.market_data?.market_cap?.usd) ?? lastKnownGood?.market.marketCap ?? null, volume24h: toNumber(coin.market_data?.total_volume?.usd) ?? lastKnownGood?.market.volume24h ?? null, dominance: toNumber(globalJson?.data?.market_cap_percentage?.btc) ?? lastKnownGood?.market.dominance ?? null, fearGreed: fearValue ?? lastKnownGood?.market.fearGreed ?? null, fearGreedLabel: fearLabel(fearValue ?? lastKnownGood?.market.fearGreed ?? null), history: { marketCap: marketCapHistory, volume24h: volumeHistory, dominance: [lastKnownGood?.market.dominance, toNumber(globalJson?.data?.market_cap_percentage?.btc)].filter((value): value is number => value != null), fearGreed: fearHistoryValues } }, catalyst: news[0] ?? null, bias: score == null ? null : { key: biasKey as any, label: biasLabel, news: scoreLabel(toNumber(sentimentRow?.newsScore ?? sentimentRow?.newsLayer?.score ?? signalData.news?.score), 'news'), institutional: scoreLabel(toNumber(sentimentRow?.institutionalScore ?? sentimentRow?.institutionalLayer?.score ?? signalData.institutional?.score), 'institutional'), traders: scoreLabel(toNumber(sentimentRow?.crowdScore ?? sentimentRow?.crowdLayer?.score ?? signalData.crowd?.score), 'crowd') }, changes: previous ? [
      { id: 'price', label: 'Precio BTC', before: currentValue(previous.market.price), after: currentValue(coin.market_data?.current_price?.usd), direction: (toNumber(coin.market_data?.price_change_percentage_24h) ?? 0) > 0 ? 'positive' as const : (toNumber(coin.market_data?.price_change_percentage_24h) ?? 0) < 0 ? 'negative' as const : 'neutral' as const },
      ...(previous.market.fearGreed != null && fearValue != null && previous.market.fearGreed !== fearValue ? [{ id: 'fear-greed', label: 'Fear & Greed', before: String(previous.market.fearGreed), after: String(fearValue), direction: fearValue > previous.market.fearGreed ? 'positive' as const : 'negative' as const }] : []),
    ].slice(0, 3) : [], watch, etf: etfParsed ?? lastKnownGood?.etf ?? null, derivatives: { funding: fundingParsed ?? lastKnownGood?.derivatives?.funding ?? null, openInterest: oiValues.length ? oiValues.reduce((sum, value) => sum + value, 0) : lastKnownGood?.derivatives?.openInterest ?? null, longPct: longPct ?? lastKnownGood?.derivatives?.longPct ?? null, shortPct: longPct == null ? lastKnownGood?.derivatives?.shortPct ?? null : 100 - longPct, liquidations24h: liquidationsParsed ?? lastKnownGood?.derivatives?.liquidations24h ?? null }, news }
  const debug: LiveDebug = { sentiment: { httpStatus: sentiment.httpStatus, rowCount: sentimentRows.length, btc24hFound: Boolean(sentimentRow), parsed: score != null }, etf: { httpStatus: etf.httpStatus, rowCount: etfRows.length, todayNY, latestRawDate: [...byDate.keys()].sort().at(-1) ?? null, latestPublishedDate, lastDay: etfParsed?.lastDay ?? null, uniqueDates: [...byDate.keys()].sort((a, b) => b.localeCompare(a)) }, funding: { httpStatus: funding.httpStatus, rowCount: rowsOf(funding.json).length, btcRows: fundingRows.length, parsed: fundingParsed != null }, openInterest: { httpStatus: openInterest.httpStatus, rowCount: oiRows.length, latestTimestamp: latestTs ?? null, rowsAtLatestTimestamp: latestRows.length, parsed: oiValues.length > 0 }, liquidations: { httpStatus: liquidations.httpStatus, parsed: liquidationsParsed != null }, market: { httpStatus: market.httpStatus, globalHttpStatus: global.httpStatus, usedStaleFallback: Boolean(lastKnownGood && (toNumber(coin.market_data?.current_price?.usd) == null || toNumber(coin.market_data?.market_cap?.usd) == null)), priceParsed: current.market.price != null, marketCapParsed: current.market.marketCap != null, volumeParsed: current.market.volume24h != null, dominanceParsed: current.market.dominance != null }, news: { parsedCount: allNews.length, bitcoinRelevantCount: btcNews.length, catalystTitle: news[0]?.title ?? null } }
  return { data: current, sources: { market: 'CoinGecko', fearGreed: 'Alternative.me', bias: 'Xoomar Sentiment', etf: 'Xoomar ETF Flows', funding: 'Xoomar Funding Rates', openInterest: 'Xoomar Open Interest', liquidations: 'Xoomar Liquidations', catalyst: news[0]?.source ?? 'RSS no disponible', news: news.length ? 'RSS filtrado BTC' : 'RSS no disponible', watch: watch.length ? 'Groq' : 'Groq sin señales' }, debug }
}
function currentValue(value: unknown) { const parsed = toNumber(value); return parsed == null ? 'Sin datos' : String(parsed) }
