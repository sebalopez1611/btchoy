import { desc } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dailySnapshots } from '@/lib/db/schema'
import { collectLiveDaily } from '@/lib/live-data'
import type { DailyData } from '@/lib/daily-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const [previous] = process.env.DATABASE_URL ? await db.select().from(dailySnapshots).orderBy(desc(dailySnapshots.snapshotDate)).limit(1) : []
    const result = await collectLiveDaily((previous?.payload as DailyData | undefined) ?? null)
    if (process.env.DATABASE_URL) {
      const snapshotDate = new Date().toISOString().slice(0, 10)
      await db.insert(dailySnapshots).values({ snapshotDate, payload: result.data }).onConflictDoUpdate({ target: dailySnapshots.snapshotDate, set: { payload: result.data, updatedAt: new Date() } })
    }
    return NextResponse.json({ data: result.data, sources: result.sources, persisted: Boolean(process.env.DATABASE_URL), generatedAt: result.data.asOf })
  } catch {
    return NextResponse.json({ data: null, sources: {}, persisted: false, error: 'Live data collection failed' }, { status: 200 })
  }
}
