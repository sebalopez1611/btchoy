'use client'

import { useEffect, useRef, useState } from 'react'

const chartConfig = {
  allow_symbol_change: false,
  calendar: false,
  details: false,
  hide_side_toolbar: true,
  hide_top_toolbar: true,
  hide_legend: true,
  hide_volume: true,
  hotlist: false,
  interval: '240',
  locale: 'es',
  save_image: false,
  style: '1',
  symbol: 'BITSTAMP:BTCUSD',
  theme: 'dark',
  timezone: 'America/New_York',
  backgroundColor: '#0F0F0F',
  gridColor: 'rgba(242, 242, 242, 0.2)',
  watchlist: [],
  withdateranges: false,
  compareSymbols: [],
  support_host: 'https://www.tradingview.com',
  studies: ['STD;Divergence%1Indicator'],
  autosize: true,
}

export function TradingViewChart() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let settled = false
    const fail = () => {
      if (settled) return
      settled = true
      setFailed(true)
    }

    container.replaceChildren()
    const widget = document.createElement('div')
    widget.className = 'tradingview-widget-container'
    const script = document.createElement('script')
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js'
    script.type = 'text/javascript'
    script.async = true
    script.textContent = JSON.stringify(chartConfig)
    script.onerror = fail
    widget.appendChild(script)
    container.appendChild(widget)

    const timeout = window.setTimeout(() => {
      if (!widget.querySelector('iframe')) fail()
    }, 10000)

    return () => {
      window.clearTimeout(timeout)
      script.onerror = null
      container.replaceChildren()
    }
  }, [])

  if (failed) {
    return <div className="tradingview-chart-wrap chart-fallback" role="status"><strong>No pudimos cargar el gráfico de TradingView.</strong><span>El resto de la edición sigue disponible.</span></div>
  }

  return <div ref={containerRef} className="tradingview-chart-wrap" aria-label="Gráfico real de Bitcoin en TradingView" />
}
