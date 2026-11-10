import { timingSafeEqual } from 'node:crypto'

export function verifyBearerSecret(authorization: string | null, expected: string) {
  const token = /^Bearer ([^\s]+)$/.exec(authorization ?? '')?.[1]
  if (!token || !expected) return false
  const received = Buffer.from(token)
  const configured = Buffer.from(expected)
  return received.length === configured.length && timingSafeEqual(received, configured)
}
