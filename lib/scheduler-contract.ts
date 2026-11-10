const CRON_SLOT_MINUTES: Record<string, { minute: number; hours: readonly number[] }> = {
  '0 9,13,17,21 * * *': { minute: 0, hours: [9, 13, 17, 21] },
  '30 19,23 * * *': { minute: 30, hours: [19, 23] },
}

export function resolveScheduledSlot(cron: string, scheduledTime: number) {
  const schedule = CRON_SLOT_MINUTES[cron]
  const date = new Date(scheduledTime)
  if (!schedule || !Number.isFinite(date.getTime())) return null
  if (!schedule.hours.includes(date.getUTCHours()) || date.getUTCMinutes() !== schedule.minute || date.getUTCSeconds() !== 0 || date.getUTCMilliseconds() !== 0) return null

  const scheduledAt = date.toISOString()
  return {
    scheduledAt,
    slotKey: `daily-market-refresh:slot:${scheduledAt}`,
  }
}
