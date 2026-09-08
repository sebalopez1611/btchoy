'use client'

import { useEffect, useRef, useState } from 'react'

export function TradingViewChart() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    container.innerHTML = ''
    const widget = document.createElement('div')
    widget.className = 'tradingview-widget-container__widget'
    widget.style.height = '100%'
    widget.style.width = '100%'
    container.appendChild(widget)

    const script = document.createElement('script')
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js'
    script.type = 'text/javascript'
    script.async = true
    script.textContent = JSON.stringify({ autosize: true, symbol: 'BINANCE:BTCUSDT', interval: '240', timezone: 'Etc/UTC', theme: 'dark', style: '1', locale: 'es', enable_publishing: false, hide_top_toolbar: true, hide_legend: true, save_image: false, hide_volume: true, backgroundColor: 'rgba(0,0,0,0)', gridColor: 'rgba(255,255,255,0.04)', allow_symbol_change: false, calendar: false, support_host: 'https://www.tradingview.com' })
    script.onerror = () => setFailed(true)
    container.appendChild(script)
    const timer = window.setTimeout(() => {
      if (!container.querySelector('iframe')) setFailed(true)
    }, 9000)
    return () => { window.clearTimeout(timer); container.innerHTML = '' }
  }, [])

  return <div className="tradingview-chart-wrap">
    <div ref={containerRef} className="tradingview-widget-container" aria-label="Gráfico de Bitcoin a cuatro horas" />
    {failed && <div className="chart-fallback" role="status">Gráfico no disponible. Mostramos la lectura de mercado sin datos simulados.</div>}
    <a className="tradingview-attribution" href="https://www.tradingview.com/symbols/BTCUSDT/" target="_blank" rel="noreferrer">Gráfico por TradingView</a>
  </div>
}
