import { randomUUID } from 'node:crypto'
import { and, desc, eq, lt, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dailySnapshots, editorialEditions, jobExecutions } from '@/lib/db/schema'
import { collectLiveDaily } from '@/lib/live-data'
import { verifyBearerSecret } from '@/lib/cron-auth'
import { resolveScheduledSlot } from '@/lib/scheduler-contract'
import type { DailyData } from '@/lib/daily-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const LOCK_KEY = 'daily-market-refresh:global-lock'
const LOCK_MS = 10 * 60_000
const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' }
const REQUIRED_QUALITY = ['market', 'bias', 'watch', 'priceHistory', 'marketCapHistory', 'volumeHistory', 'fearGreed', 'fearGreedHistory', 'etf', 'funding', 'openInterest', 'liquidations', 'news'] as const

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

function runLog(event: string, details: Record<string, unknown>) {
  console.info(JSON.stringify({ event: `daily-update-${event}`, at: new Date().toISOString(), ...details }))
}

export async function POST(request: Request) {
  const expected = process.env.DAILY_UPDATE_SECRET
  if (!expected) {
    console.error(JSON.stringify({ event: 'daily-update-rejected', reason: 'secret_not_configured' }))
    return json({ error: 'Scheduler authentication is not configured' }, 503)
  }
  if (!verifyBearerSecret(request.headers.get('authorization'), expected)) {
    console.warn(JSON.stringify({ event: 'daily-update-rejected', reason: 'unauthorized' }))
    return json({ error: 'Unauthorized' }, 401)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }
  if (!body || typeof body !== 'object' || !('cron' in body) || !('scheduledTime' in body) || typeof body.cron !== 'string' || typeof body.scheduledTime !== 'number') {
    return json({ error: 'Invalid scheduled event' }, 400)
  }
  const slot = resolveScheduledSlot(body.cron, body.scheduledTime)
  if (!slot) return json({ error: 'Unsupported cron slot' }, 400)

  const startedAt = new Date()
  const lockedUntil = new Date(startedAt.getTime() + LOCK_MS)
  const slotKey = slot.slotKey
  const lockToken = randomUUID()
  let reservation: 'acquired' | 'duplicate' | 'busy'

  try {
    reservation = await db.transaction(async (tx) => {
      const [slotRecord] = await tx.insert(jobExecutions).values({
        jobKey: slotKey,
        status: 'reserved',
        lockedUntil: null,
        startedAt,
        attempts: 1,
        updatedAt: startedAt,
        metadata: { cron: body.cron, scheduledTime: slot.scheduledAt },
      }).onConflictDoNothing({ target: jobExecutions.jobKey }).returning({ jobKey: jobExecutions.jobKey })
      if (!slotRecord) return 'duplicate'

      const [lock] = await tx.insert(jobExecutions).values({
        jobKey: LOCK_KEY,
        status: 'running',
        lockedUntil,
        startedAt,
        attempts: 1,
        inputHash: lockToken,
        updatedAt: startedAt,
        metadata: { slotKey },
      }).onConflictDoUpdate({
        target: jobExecutions.jobKey,
        set: { status: 'running', lockedUntil, startedAt, attempts: sql`${jobExecutions.attempts} + 1`, inputHash: lockToken, error: null, updatedAt: startedAt, metadata: { slotKey } },
        setWhere: sql`(${jobExecutions.status} <> 'running' OR ${jobExecutions.lockedUntil} IS NULL OR ${jobExecutions.lockedUntil} < ${startedAt})`,
      }).returning({ jobKey: jobExecutions.jobKey })

      if (!lock) {
        const finishedAt = new Date()
        await tx.update(jobExecutions).set({ status: 'skipped_concurrent', finishedAt, error: 'another_update_running', updatedAt: finishedAt, metadata: { cron: body.cron, scheduledTime: slot.scheduledAt, result: 'skipped_concurrent' } }).where(eq(jobExecutions.jobKey, slotKey))
        return 'busy'
      }

      await tx.update(jobExecutions).set({ status: 'running', metadata: { cron: body.cron, scheduledTime: slot.scheduledAt, globalLock: LOCK_KEY } }).where(eq(jobExecutions.jobKey, slotKey))
      return 'acquired'
    })
  } catch (error) {
    console.error(JSON.stringify({ event: 'daily-update-reservation-failed', slot: slot.scheduledAt, error: error instanceof Error ? error.message.slice(0, 300) : 'database_error' }))
    return json({ error: 'Could not reserve scheduled update' }, 500)
  }

  if (reservation === 'duplicate') {
    runLog('duplicate', { slot: slot.scheduledAt, result: 'deduplicated' })
    return json({ status: 'deduplicated', scheduledAt: slot.scheduledAt }, 202)
  }
  if (reservation === 'busy') {
    runLog('skipped', { slot: slot.scheduledAt, result: 'skipped_concurrent' })
    return json({ status: 'skipped_concurrent', scheduledAt: slot.scheduledAt }, 202)
  }

  runLog('started', { slot: slot.scheduledAt, cron: body.cron, startedAt: startedAt.toISOString() })
  try {
    const [historical, lastKnown] = await Promise.all([
      db.select().from(dailySnapshots).where(lt(dailySnapshots.snapshotDate, slot.scheduledAt.slice(0, 10))).orderBy(desc(dailySnapshots.snapshotDate)).limit(90),
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
    const sourceHealth = (result.debug.sources ?? {}) as Record<string, { httpStatus?: number | null; ok?: boolean; parsed?: boolean }>
    const groqDebug = (result.debug.watch ?? {}) as { groqCalled?: boolean; groqHttpStatus?: number | null; groqModel?: string | null; groqUsage?: { promptTokens: number | null; completionTokens: number | null; totalTokens: number | null } | null; groqParsedCount?: number }
    const quality = {
      market: result.data.market.price != null && sourceHealth.bitcoin?.ok === true && sourceHealth.bitcoin.parsed === true && sourceHealth.global?.ok === true && sourceHealth.global.parsed === true,
      bias: result.data.bias != null && result.data.bias.stale !== true && sourceHealth.bias?.parsed === true,
      watch: result.data.watch.length > 0,
      priceHistory: (result.data.market.history?.price?.length ?? 0) >= 2 && sourceHealth.marketHistory?.parsed === true,
      marketCapHistory: (result.data.market.history?.marketCap?.length ?? 0) >= 2 && sourceHealth.marketHistory?.parsed === true,
      volumeHistory: (result.data.market.history?.volume24h?.length ?? 0) >= 2 && sourceHealth.marketHistory?.parsed === true,
      fearGreed: result.data.market.fearGreed != null && sourceHealth.fear?.parsed === true,
      fearGreedHistory: sourceHealth.fearHistory?.parsed === true,
      etf: result.data.etf != null && sourceHealth.etf?.parsed === true,
      funding: result.data.derivatives?.funding != null && sourceHealth.funding?.parsed === true,
      openInterest: result.data.derivatives?.openInterest != null && sourceHealth.openInterest?.parsed === true,
      liquidations: result.data.derivatives?.liquidations24h != null && sourceHealth.liquidations?.parsed === true,
      news: sourceHealth.news?.ok === true,
    }
    const failures = REQUIRED_QUALITY.filter((key) => !quality[key])
    const finishedAt = new Date()
    const executionMetadata = {
      cron: body.cron,
      scheduledTime: slot.scheduledAt,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      result: failures.length ? 'partial' : 'completed',
      sources: result.sources,
      sourceHealth,
      quality,
      failures,
      groq: { called: groqDebug.groqCalled ?? false, httpStatus: groqDebug.groqHttpStatus ?? null, model: groqDebug.groqModel ?? null, tokenUsage: groqDebug.groqUsage ?? null, parsedCount: groqDebug.groqParsedCount ?? 0 },
    }

    if (failures.length) {
      await db.update(jobExecutions).set({ status: 'partial', finishedAt, lockedUntil: null, error: `incomplete_sources:${failures.join(',')}`, updatedAt: finishedAt, metadata: executionMetadata }).where(eq(jobExecutions.jobKey, slotKey))
      runLog('partial', { slot: slot.scheduledAt, failures, sourceHealth, groq: executionMetadata.groq, preservedLastEdition: true })
      return json({ status: 'partial', scheduledAt: slot.scheduledAt, quality, failures, preservedLastEdition: true }, 503)
    }

    const snapshotDate = slot.scheduledAt.slice(0, 10)
    const generationMode = (groqDebug.groqParsedCount ?? 0) === 0 ? 'deterministic' : (groqDebug.groqParsedCount ?? 0) < result.data.watch.length ? 'mixed' : 'groq'
    await db.transaction(async (tx) => {
      await tx.insert(dailySnapshots).values({ snapshotDate, payload: result.data, updatedAt: finishedAt }).onConflictDoUpdate({ target: dailySnapshots.snapshotDate, set: { payload: result.data, updatedAt: finishedAt } })
      await tx.insert(editorialEditions).values({ editionKey: `market-${snapshotDate}`, editionDate: snapshotDate, payload: result.data, generatedAt: finishedAt, marketAsOf: new Date(result.data.asOf), status: 'valid', generationMode, model: groqDebug.groqModel ?? null, tokenUsage: groqDebug.groqUsage ?? null, updatedAt: finishedAt }).onConflictDoUpdate({ target: editorialEditions.editionKey, set: { payload: result.data, generatedAt: finishedAt, marketAsOf: new Date(result.data.asOf), status: 'valid', generationMode, model: groqDebug.groqModel ?? null, tokenUsage: groqDebug.groqUsage ?? null, updatedAt: finishedAt } })
      await tx.update(jobExecutions).set({ status: 'completed', finishedAt, lockedUntil: null, error: null, updatedAt: finishedAt, metadata: executionMetadata }).where(eq(jobExecutions.jobKey, slotKey))
    })

    runLog('completed', { slot: slot.scheduledAt, startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), sources: result.sources, sourceHealth, groq: executionMetadata.groq, quality })
    return json({ status: 'published', scheduledAt: slot.scheduledAt, generatedAt: finishedAt.toISOString(), sources: result.sources })
  } catch (error) {
    const finishedAt = new Date()
    const safeError = error instanceof Error ? error.message.slice(0, 500) : 'unknown_error'
    try {
      await db.update(jobExecutions).set({ status: 'failed', finishedAt, lockedUntil: null, error: safeError, updatedAt: finishedAt, metadata: { cron: body.cron, scheduledTime: slot.scheduledAt, startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), result: 'failed', error: safeError, preservedLastEdition: true } }).where(eq(jobExecutions.jobKey, slotKey))
    } catch (logError) {
      console.error(JSON.stringify({ event: 'daily-update-failure-log-error', slot: slot.scheduledAt, error: logError instanceof Error ? logError.message.slice(0, 300) : 'database_error' }))
    }
    console.error(JSON.stringify({ event: 'daily-update-failed', slot: slot.scheduledAt, startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), error: safeError, preservedLastEdition: true }))
    return json({ status: 'failed', scheduledAt: slot.scheduledAt, preservedLastEdition: true }, 500)
  } finally {
    try {
      await db.update(jobExecutions).set({ status: 'released', lockedUntil: null, inputHash: null, updatedAt: new Date() }).where(and(eq(jobExecutions.jobKey, LOCK_KEY), eq(jobExecutions.inputHash, lockToken)))
    } catch (error) {
      console.error(JSON.stringify({ event: 'daily-update-lock-release-failed', slot: slot.scheduledAt, error: error instanceof Error ? error.message.slice(0, 300) : 'database_error' }))
    }
  }
}
