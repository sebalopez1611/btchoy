import { getDailyData } from '@/lib/daily-data'
import { LiveBitcoinPage } from '@/components/bitcoin-hoy/live-page'

export default async function Page() {
  const data = await getDailyData()
  return <LiveBitcoinPage initialData={data} />
}
