'use client'

import { useEffect, useState } from 'react'
import type { DailyData } from '@/lib/daily-types'
import { AffiliateModal, BitcoinChart, CatalystCard, DailyChanges, DailyHero, DerivativesCard, Footer, MarketBias, SecondaryNews, WatchToday, ETFCard } from '@/components/bitcoin-hoy/sections'

export function LiveBitcoinPage({ initialData }: { initialData: DailyData | null }) {
  const [data, setData] = useState<DailyData | null>(initialData)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    setRefreshing(true)
    fetch('/api/daily', { signal: controller.signal, cache: 'no-store' })
      .then((response) => response.json())
      .then((payload) => {
        if (payload.data) setData(payload.data)
        else setError(true)
      })
      .catch(() => setError(true))
      .finally(() => { setLoading(false); setRefreshing(false) })
    return () => controller.abort()
  }, [])

  if (!data) return <main><div className="site-shell"><div className="state-card" role={error ? 'alert' : 'status'}><p className="eyebrow">BITCOIN HOY</p><h1>{error ? 'No pudimos cargar el briefing' : 'Cargando briefing'}</h1><p>{error ? 'Las fuentes siguen sin responder. Puedes reintentar sin perder esta página.' : 'Consultando las fuentes de mercado…'}</p>{error && <button className="secondary-cta" onClick={() => window.location.reload()}>Reintentar</button>}</div></div></main>

  return <main aria-busy={loading}><div className="site-shell">{refreshing && <div className="refresh-status" role="status">Actualizando datos en segundo plano…</div>}<DailyHero data={data} /><CatalystCard catalyst={data.catalyst} /><section className="market-grid"><BitcoinChart /><MarketBias bias={data.bias} /></section><DailyChanges changes={data.changes} /><WatchToday watch={data.watch} /><section className="data-grid"><ETFCard etf={data.etf} /><DerivativesCard derivatives={data.derivatives} /></section><SecondaryNews news={data.news} /><Footer /></div><AffiliateModal /></main>
}
