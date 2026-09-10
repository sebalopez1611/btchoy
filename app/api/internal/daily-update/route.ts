import { revalidateTag } from 'next/cache'
import { desc, eq, lt, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dailySnapshots, editorialEditions, jobExecutions } from '@/lib/db/schema'
import { collectLiveDaily } from '@/lib/live-data'
import type { DailyData } from '@/lib/daily-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const JOB_KEY = 'daily-market-refresh'
const LOCK_MINUTES = 10

async function updateDaily(request: Request) {
  const expected = process.env.CRON_SECRET ?? process.env.DAILY_UPDATE_SECRET
  if (!expected || request.headers.get('authorization') !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const lockedUntil = new Date(now.getTime() + LOCK_MINUTES * 60_000)
  const [lock] = await db.insert(jobExecutions).values({ jobKey: JOB_KEY, status: 'running', lockedUntil, startedAt: now, attempts: 1, updatedAt: now }).onConflictDoUpdate({
    target: jobExecutions.jobKey,
    set: { status: 'running', lockedUntil, startedAt: now, attempts: sql`${jobExecutions.attempts} + 1`, error: null, updatedAt: now },
    setWhere: sql`(${jobExecutions.status} <> 'running' OR ${jobExecutions.lockedUntil} IS NULL OR ${jobExecutions.lockedUntil} < ${now})`,
  }).returning()

  if (!lock) return NextResponse.json({ status: 'deduplicated' }, { status: 202 })

  try {
    const [historical, lastKnown] = await Promise.all([
      db.select().from(dailySnapshots).where(lt(dailySnapshots.snapshotDate, now.toISOString().slice(0, 10))).orderBy(desc(dailySnapshots.snapshotDate)).limit(90),
      db.select().from(dailySnapshots).orderBy(desc(dailySnapshots.snapshotDate)).limit(30),
    ])
    const previous = historical.find((row) => (row.payload as Partial<DailyData>).market?.price != null)
    const lastKnownMarket = lastKnown.find((row) => (row.payload as Partial<DailyData>).market?.price != null)
    const lastKnownBias = lastKnown.find((row) => (row.payload as Partial<DailyData>).bias != null)
    const lastKnownMarketCap = lastKnown.find((row) => ((row.payload as Partial<DailyData>).market?.history?.marketCap?.length ?? 0) >= 2)
    const lastKnownVolume = lastKnown.find((row) => ((row.payload as Partial<DailyData>).market?.history?.volume24h?.length ?? 0) >= 2)
    const marketPayload = (lastKnownMarket?.payload ?? {}) as DailyData
    const biasPayload = (lastKnownBias?.payload ?? {}) as DailyData
    const marketCapPayload = (lastKnownMarketCap?.payload ?? {}) as DailyData
    const volumePayload = (lastKnownVolume?.payload ?? {}) as DailyData
    const lastKnownGood: DailyData = { ...marketPayload, bias: biasPayload.bias ?? null, market: { ...marketPayload.market, history: { ...marketPayload.market?.history, marketCap: marketCapPayload.market?.history?.marketCap ?? [], volume24h: volumePayload.market?.history?.volume24h ?? [] } } } as DailyData
    const result = await collectLiveDaily((previous?.payload as DailyData | undefined) ?? null, lastKnownGood)
    const snapshotDate = now.toISOString().slice(0, 10)
    const quality = { market: result.data.market.price != null, bias: result.data.bias != null, watch: result.data.watch.length > 0, marketCapHistory: (result.data.market.history?.marketCap?.length ?? 0) >= 2, volumeHistory: (result.data.market.history?.volume24h?.length ?? 0) >= 2 }
    const isFullyValid = Object.values(quality).every(Boolean)
    if (!isFullyValid) {
      await db.update(jobExecutions).set({ status: 'partial', finishedAt: new Date(), lockedUntil: null, updatedAt: new Date(), metadata: { sources: result.sources, quality } }).where(eq(jobExecutions.jobKey, JOB_KEY))
      return NextResponse.json({ status: 'partial', quality, preservedLastEdition: true }, { status: 503 })
    }
    await db.insert(dailySnapshots).values({ snapshotDate, payload: result.data, updatedAt: now }).onConflictDoUpdate({ target: dailySnapshots.snapshotDate, set: { payload: result.data, updatedAt: now } })
    await db.insert(editorialEditions).values({ editionKey: `market-${snapshotDate}`, editionDate: snapshotDate, payload: result.data, generatedAt: now, marketAsOf: new Date(result.data.asOf), status: 'valid', generationMode: result.data.watch?.some((item) => item.detail) ? 'mixed' : 'deterministic', updatedAt: now }).onConflictDoUpdate({ target: editorialEditions.editionKey, set: { payload: result.data, generatedAt: now, marketAsOf: new Date(result.data.asOf), status: 'valid', updatedAt: now } })
    await db.update(jobExecutions).set({ status: 'completed', finishedAt: new Date(), lockedUntil: null, updatedAt: new Date(), metadata: { sources: result.sources } }).where(eq(jobExecutions.jobKey, JOB_KEY))
    revalidateTag('published-daily-data', 'max')
    return NextResponse.json({ status: 'published', generatedAt: now.toISOString(), sources: result.sources })
  } catch (error) {
    await db.update(jobExecutions).set({ status: 'failed', finishedAt: new Date(), lockedUntil: null, error: error instanceof Error ? error.message.slice(0, 500) : 'unknown_error', updatedAt: new Date() }).where(eq(jobExecutions.jobKey, JOB_KEY))
    return NextResponse.json({ status: 'failed', preservedLastEdition: true }, { status: 500 })
  }
}

export const GET = updateDaily
export const POST = updateDaily
