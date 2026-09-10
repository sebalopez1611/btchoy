import { desc, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dailySnapshots, editorialEditions } from '@/lib/db/schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const [edition] = await db.select().from(editorialEditions).where(eq(editorialEditions.status, 'valid')).orderBy(desc(editorialEditions.generatedAt)).limit(1)
    if (edition) return NextResponse.json({ data: edition.payload, generatedAt: edition.generatedAt, marketAsOf: edition.marketAsOf, source: 'editorial_edition' }, { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60' } })
    const [snapshot] = await db.select().from(dailySnapshots).orderBy(desc(dailySnapshots.snapshotDate)).limit(1)
    return NextResponse.json({ data: snapshot?.payload ?? null, generatedAt: snapshot?.updatedAt ?? null, source: snapshot ? 'legacy_snapshot' : null }, { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60' } })
  } catch {
    return NextResponse.json({ data: null, error: 'Published data unavailable' }, { status: 503 })
  }
}
