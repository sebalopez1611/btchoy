import { getDailyData } from '@/lib/daily-data'
import { AffiliateModal, BitcoinChart, CatalystCard, DailyChanges, DailyHero, DerivativesCard, ETFCard, Footer, MarketBias, SecondaryNews, WatchToday } from '@/components/bitcoin-hoy/sections'

export default async function Page() {
  const data = await getDailyData()
  return <main><div className="site-shell"><DailyHero data={data} /><CatalystCard catalyst={data.catalyst} /><section className="market-grid"><BitcoinChart /><MarketBias bias={data.bias} /></section><DailyChanges changes={data.changes} /><WatchToday watch={data.watch} /><section className="data-grid"><ETFCard etf={data.etf} /><DerivativesCard derivatives={data.derivatives} /></section><SecondaryNews news={data.news} /><Footer /></div><AffiliateModal /></main>
}
