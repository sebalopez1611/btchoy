import { and, desc, eq } from "drizzle-orm"
import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { dailySnapshots, type DailySnapshotPayload } from "@/lib/db/schema"

export const runtime = "nodejs"

function isPayload(value: unknown): value is DailySnapshotPayload {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export async function GET(request: Request) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ data: null, source: "fallback", error: "Database unavailable" }, { status: 200 })
  }

  const { searchParams } = new URL(request.url)
  const date = searchParams.get("date")

  try {
    const rows = await db
      .select()
      .from(dailySnapshots)
      .where(date ? eq(dailySnapshots.snapshotDate, date) : undefined)
      .orderBy(desc(dailySnapshots.snapshotDate))
      .limit(date ? 1 : 7)

    return NextResponse.json({ data: date ? rows[0] ?? null : rows, source: "neon" })
  } catch {
    return NextResponse.json({ data: null, source: "fallback", error: "Snapshot read failed" }, { status: 200 })
  }
}

export async function POST(request: Request) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 })
  }

  try {
    const body = (await request.json()) as { date?: unknown; payload?: unknown }
    const snapshotDate = typeof body.date === "string" ? body.date : new Date().toISOString().slice(0, 10)

    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(snapshotDate) || !isPayload(body.payload)) {
      return NextResponse.json({ error: "date and payload are required" }, { status: 400 })
    }

    const [snapshot] = await db
      .insert(dailySnapshots)
      .values({ snapshotDate, payload: body.payload })
      .onConflictDoUpdate({
        target: dailySnapshots.snapshotDate,
        set: { payload: body.payload, updatedAt: new Date() },
      })
      .returning()

    return NextResponse.json({ data: snapshot, source: "neon" }, { status: 201 })
  } catch {
    return NextResponse.json({ error: "Snapshot write failed" }, { status: 500 })
  }
}
