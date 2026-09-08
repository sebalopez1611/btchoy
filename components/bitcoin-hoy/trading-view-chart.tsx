'use client'

import { useEffect, useRef } from 'react'

const config = {
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

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    if (window.self !== window.top) {
      container.innerHTML = '<div class="chart-fallback" role="status"><strong>Gráfico en vivo disponible al publicar.</strong><span>TradingView bloquea la ejecución del widget dentro de esta vista previa embebida.</span></div>'
      return
    }
    container.replaceChildren()
    const widget = document.createElement('div')
    widget.className = 'tradingview-widget-container__widget'
    container.appendChild(widget)
    const script = document.createElement('script')
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js'
    script.async = true
    script.innerHTML = JSON.stringify(config)
    widget.appendChild(script)
    return () => container.replaceChildren()
  }, [])

  return <div ref={containerRef} className="tradingview-chart-wrap" aria-label="Gráfico real de Bitcoin en TradingView" />
}
