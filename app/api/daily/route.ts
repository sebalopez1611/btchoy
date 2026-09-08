import { desc, lt } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dailySnapshots } from '@/lib/db/schema'
import { collectLiveDaily } from '@/lib/live-data'
import type { DailyData } from '@/lib/daily-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const debugRequested = new URL(request.url).searchParams.get('debug') === '1'
  try {
    const today = new Date().toISOString().slice(0, 10)
    const [previous] = process.env.DATABASE_URL ? await db.select().from(dailySnapshots).where(lt(dailySnapshots.snapshotDate, today)).orderBy(desc(dailySnapshots.snapshotDate)).limit(1) : []
    const result = await collectLiveDaily((previous?.payload as DailyData | undefined) ?? null)
    if (process.env.DATABASE_URL) {
      const snapshotDate = new Date().toISOString().slice(0, 10)
      await db.insert(dailySnapshots).values({ snapshotDate, payload: result.data }).onConflictDoUpdate({ target: dailySnapshots.snapshotDate, set: { payload: result.data, updatedAt: new Date() } })
    }
    return NextResponse.json({ data: result.data, sources: result.sources, persisted: Boolean(process.env.DATABASE_URL), generatedAt: result.data.asOf, ...(debugRequested ? { _debug: result.debug } : {}) })
  } catch {
    return NextResponse.json({ data: null, sources: {}, persisted: false, error: 'Live data collection failed', ...(debugRequested ? { _debug: { error: 'collector_failed' } } : {}) }, { status: 200 })
  }
}
