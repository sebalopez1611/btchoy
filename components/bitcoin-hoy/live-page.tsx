'use client'

import { useEffect, useState } from 'react'
import type { DailyData } from '@/lib/daily-types'
import { AffiliateModal, BitcoinChart, CatalystCard, DailyChanges, DailyHero, DerivativesCard, Footer, MarketBias, SecondaryNews, WatchToday, ETFCard } from '@/components/bitcoin-hoy/sections'

export function LiveBitcoinPage({ initialData }: { initialData: DailyData | null }) {
  const [data, setData] = useState<DailyData | null>(initialData)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/daily', { signal: controller.signal, cache: 'no-store' })
      .then((response) => response.json())
      .then((payload) => {
        if (payload.data) setData(payload.data)
        else setError(true)
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [])

  if (!data) return <main><div className="site-shell"><div className="state-card"><p className="eyebrow">BITCOIN HOY</p><h1>{error ? 'No pudimos cargar el briefing' : 'Cargando briefing'}</h1><p>{error ? 'Las fuentes siguen sin responder. Inténtalo de nuevo en unos minutos.' : 'Consultando las fuentes de mercado…'}</p></div></div></main>

  return <main aria-busy={loading}><div className="site-shell"><DailyHero data={data} /><CatalystCard catalyst={data.catalyst} /><section className="market-grid"><BitcoinChart /><MarketBias bias={data.bias} /></section><DailyChanges changes={data.changes} /><WatchToday watch={data.watch} /><section className="data-grid"><ETFCard etf={data.etf} /><DerivativesCard derivatives={data.derivatives} /></section><SecondaryNews news={data.news} /><Footer /></div><AffiliateModal /></main>
}
