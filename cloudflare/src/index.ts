interface Env {
  VERCEL_UPDATE_URL: string
  VERCEL_DAILY_UPDATE_TOKEN: string
}

interface ScheduledController {
  cron: string
  scheduledTime: number
}

const allowedCrons = new Set([
  '0 9,13,17,21 * * *',
  '30 19,23 * * *',
])

function getUpdateUrl(value: string) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.pathname !== '/api/internal/daily-update' || url.search || url.hash) {
    throw new Error('VERCEL_UPDATE_URL must be the HTTPS production daily-update route')
  }
  return url
}

export async function dispatchScheduled(controller: ScheduledController, env: Env, send: typeof fetch = fetch) {
  const startedAt = Date.now()
  const scheduledAt = new Date(controller.scheduledTime)
  const scheduledIso = Number.isFinite(scheduledAt.getTime()) ? scheduledAt.toISOString() : null

  try {
    if (!allowedCrons.has(controller.cron) || !scheduledIso) throw new Error('Unexpected scheduled event')
    if (!env.VERCEL_DAILY_UPDATE_TOKEN) throw new Error('VERCEL_DAILY_UPDATE_TOKEN is not configured')

    const response = await send(getUpdateUrl(env.VERCEL_UPDATE_URL), {
      method: 'POST',
      redirect: 'error',
      cache: 'no-store',
      headers: {
        authorization: `Bearer ${env.VERCEL_DAILY_UPDATE_TOKEN}`,
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
      body: JSON.stringify({ cron: controller.cron, scheduledTime: controller.scheduledTime }),
      signal: AbortSignal.timeout(150_000),
    })
    const result = await response.json().catch(() => null) as { status?: string; error?: string } | null
    const log = {
      event: 'bitcoin-hoy-scheduled-update',
      cron: controller.cron,
      scheduledAt: scheduledIso,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      httpStatus: response.status,
      result: result?.status ?? (response.ok ? 'accepted' : 'rejected'),
      error: result?.error,
    }
    if (!response.ok) throw new Error(`Vercel update route returned HTTP ${response.status}`)
    console.info(JSON.stringify(log))
  } catch (error) {
    console.error(JSON.stringify({
      event: 'bitcoin-hoy-scheduled-update-failed',
      cron: controller.cron,
      scheduledAt: scheduledIso,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : 'request_failed',
    }))
    throw error
  }
}

export default {
  async scheduled(controller: ScheduledController, env: Env) {
    return dispatchScheduled(controller, env)
  },
}
