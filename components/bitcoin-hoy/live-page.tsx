'use client'

import { useState } from 'react'
import type { DailyData } from '@/lib/daily-types'
import { AffiliateModal, BitcoinChart, CatalystCard, DailyChanges, DailyHero, DerivativesCard, Footer, MarketBias, SecondaryNews, WatchToday, ETFCard } from '@/components/bitcoin-hoy/sections'

export function LiveBitcoinPage({ initialData }: { initialData: DailyData | null }) {
  const [data, setData] = useState<DailyData | null>(initialData)
  const [error] = useState(false)

  if (!data) return <main><div className="site-shell"><div className="state-card" role={error ? 'alert' : 'status'}><p className="eyebrow">BITCOIN HOY</p><h1>No hay una edición publicada</h1><p>El próximo trabajo editorial publicará una nueva actualización.</p></div></div></main>

  return <main><div className="site-shell"><DailyHero data={data} /><CatalystCard catalyst={data.catalyst} /><section className="market-grid"><BitcoinChart /><MarketBias bias={data.bias} /></section><DailyChanges changes={data.changes} /><WatchToday watch={data.watch} /><section className="data-grid"><ETFCard etf={data.etf} /><DerivativesCard derivatives={data.derivatives} /></section><SecondaryNews news={data.news} /><Footer /></div><AffiliateModal /></main>
}
