import { z } from 'zod'
import type { DailyData } from '@/lib/daily-types'

const XOOMAR_BASE = 'https://xoomar.com/api'
const SOURCE_TIMEOUT_MS = 7000

const num = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[$,%\s,]/g, ''))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null
const payloadOf = (value: any) => value?.data ?? value?.result ?? value

async function sourceJson(path: string, init?: RequestInit) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS)
  try {
    const response = await fetch(path, { ...init, signal: controller.signal, next: { revalidate: 300 } })
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
    return await response.json()
  } finally { clearTimeout(timeout) }
}

async function rss(url: string, source: string) {
  const xml = await (await fetch(url, { next: { revalidate: 300 }, signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS) })).text()
  return [...xml.matchAll(/<item[\s\S]*?<\/item>/gi)].map((match) => {
    const item = match[0]
    const get = (tag: string) => text(item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ''))
    return { title: get('title') ?? 'Noticia sin título', source, ago: get('pubDate'), url: get('link') }
  }).filter((item) => item.title).slice(0, 8)
}

const groqSchema = z.object({
  watch: z.array(z.object({ category: z.string(), title: z.string(), detail: z.string(), importance: z.enum(['high', 'medium', 'low']) })).max(5),
})

async function groqWatch(input: unknown) {
  if (!process.env.GROQ_API_KEY) return []
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
    body: JSON.stringify({ model: process.env.GROQ_MODEL ?? 'openai/gpt-oss-20b', temperature: 0, response_format: { type: 'json_object' }, messages: [
      { role: 'system', content: 'Devuelve JSON con una única clave watch. Crea hasta 5 puntos de vigilancia basados exclusivamente en los datos recibidos. No inventes noticias, eventos, fechas ni valores. Si no hay evidencia suficiente, devuelve watch vacío.' },
      { role: 'user', content: JSON.stringify(input) },
    ] }),
  })
  if (!response.ok) throw new Error('Groq request failed')
  const json = await response.json()
  const parsed = groqSchema.safeParse(JSON.parse(json.choices?.[0]?.message?.content ?? '{}'))
  return parsed.success ? parsed.data.watch : []
}

const settled = async <T>(promise: Promise<T>, fallback: T) => {
  const result = await promise.then((value) => ({ status: 'fulfilled' as const, value })).catch(() => ({ status: 'rejected' as const }))
  return result.status === 'fulfilled' ? result.value : fallback
}

export async function collectLiveDaily(previous?: DailyData | null): Promise<{ data: DailyData; sources: Record<string, string> }> {
  const [market, fear, sentiment, etf, funding, openInterest, liquidations, coindesk, cointelegraph] = await Promise.allSettled([
    sourceJson('https://api.coingecko.com/api/v3/coins/bitcoin?localization=false&tickers=false&community_data=false&developer_data=false'),
    sourceJson('https://api.alternative.me/fng/?limit=1'),
    sourceJson(`${XOOMAR_BASE}/markets/sentiment/btc`),
    sourceJson(`${XOOMAR_BASE}/markets/etf-flows?asset=btc`),
    sourceJson(`${XOOMAR_BASE}/markets/funding-rates`),
    sourceJson(`${XOOMAR_BASE}/markets/open-interest/btc`),
    sourceJson(`${XOOMAR_BASE}/markets/liquidations`),
    rss('https://www.coindesk.com/arc/outboundfeeds/rss/', 'CoinDesk'),
    rss('https://cointelegraph.com/rss', 'Cointelegraph'),
  ])
  const value = <T,>(item: PromiseSettledResult<T>, fallback: T) => item.status === 'fulfilled' ? item.value : fallback
  const coin = value(market, {}) as any
  const fearData = value(fear, {}) as any
  const sentimentData = payloadOf(value(sentiment, {})) as any
  const etfData = payloadOf(value(etf, {})) as any
  const fundingData = payloadOf(value(funding, {})) as any
  const oiData = payloadOf(value(openInterest, {})) as any
  const liqData = payloadOf(value(liquidations, {})) as any
  const news = [...value(coindesk, [] as any[]), ...value(cointelegraph, [] as any[])].slice(0, 6)
  const score = num(sentimentData?.composite ?? sentimentData?.score)
  const biasKey = score == null ? 'neutral' : score >= 0.55 ? 'bullish' : score >= 0.15 ? 'moderately_bullish' : score <= -0.55 ? 'bearish' : score <= -0.15 ? 'moderately_bearish' : 'neutral'
  const biasLabel = { bullish: 'Alcista', moderately_bullish: 'Alcista moderado', neutral: 'Neutral', moderately_bearish: 'Bajista moderado', bearish: 'Bajista' }[biasKey]
  const rawWatch = await settled(groqWatch({ market: coin.market_data, fearGreed: fearData?.data?.[0], sentiment: sentimentData, etf: etfData, funding: fundingData, openInterest: oiData, liquidations: liqData }), [])
  const current: DailyData = {
    asOf: new Date().toISOString(),
    market: { price: num(coin.market_data?.current_price?.usd), change24h: num(coin.market_data?.price_change_percentage_24h), marketCap: num(coin.market_data?.market_cap?.usd), volume24h: num(coin.market_data?.total_volume?.usd), dominance: num(coin.market_data?.market_cap_percentage?.btc), fearGreed: num(fearData?.data?.[0]?.value), fearGreedLabel: text(fearData?.data?.[0]?.value_classification) },
    catalyst: news[0] ?? null,
    bias: score == null ? null : { key: biasKey as any, label: biasLabel, news: text(sentimentData?.news), institutional: text(sentimentData?.institutional), traders: text(sentimentData?.traders) },
    changes: [],
    watch: rawWatch,
    etf: { lastDay: num(etfData?.lastDay ?? etfData?.daily ?? etfData?.netFlow), days7: num(etfData?.days7 ?? etfData?.sevenDay), days30: num(etfData?.days30 ?? etfData?.thirtyDay), change30d: num(etfData?.change30d) },
    derivatives: { funding: num(fundingData?.funding ?? fundingData?.btc?.fundingRate), openInterest: num(oiData?.openInterest ?? oiData?.btc?.openInterest), longPct: num(oiData?.longPct ?? oiData?.btc?.longPct), shortPct: num(oiData?.shortPct ?? oiData?.btc?.shortPct), liquidations24h: num(liqData?.total24h ?? liqData?.btc?.total24h) },
    news,
  }
  current.changes = previous ? [{ id: 'price', label: 'BTC', before: previous.market.price == null ? 'Sin datos' : String(previous.market.price), after: currentValue(coin.market_data?.current_price?.usd), direction: 'neutral' }] : []
  const sources = { market: 'CoinGecko', fearGreed: 'Alternative.me', bias: score == null ? 'Xoomar Sentiment BTC: sin datos válidos' : 'Xoomar Sentiment BTC', etf: etfData && Object.keys(etfData).length ? 'Xoomar ETF Flows' : 'Xoomar ETF Flows: sin datos válidos', funding: fundingData && Object.keys(fundingData).length ? 'Xoomar Funding Rates' : 'Xoomar Funding Rates: sin datos válidos', openInterest: oiData && Object.keys(oiData).length ? 'Xoomar Open Interest' : 'Xoomar Open Interest: sin datos válidos', liquidations: liqData && Object.keys(liqData).length ? 'Xoomar Liquidations' : 'Xoomar Liquidations: sin datos válidos', catalyst: news[0]?.source ?? 'RSS no disponible', news: news.length ? 'CoinDesk + Cointelegraph RSS' : 'RSS no disponible', watch: rawWatch.length ? 'Groq (validado con Zod)' : 'Groq: sin datos válidos' }
  return { data: current, sources }
}

function currentValue(value: unknown) { const parsed = num(value); return parsed == null ? 'Sin datos' : String(parsed) }
