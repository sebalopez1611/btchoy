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

export async function POST(request: Request) {
  const expected = process.env.DAILY_UPDATE_SECRET
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
    const lastKnownGood = lastKnown.find((row) => { const payload = row.payload as Partial<DailyData>; return payload.market?.price != null && payload.market?.marketCap != null })
    const result = await collectLiveDaily((previous?.payload as DailyData | undefined) ?? null, (lastKnownGood?.payload as DailyData | undefined) ?? null)
    const snapshotDate = now.toISOString().slice(0, 10)
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
