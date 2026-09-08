'use client'

import { useState } from 'react'

const widgetUrl = 'https://www.tradingview.com/widgetembed/?symbol=BINANCE%3ABTCUSDT&interval=240&hidesidetoolbar=1&hidetoptoolbar=1&hidelegend=1&saveimage=0&theme=dark&style=1&timezone=Etc%2FUTC&withdateranges=0&hidevolume=1&studies=[]&locale=es'

export function TradingViewChart() {
  const [failed, setFailed] = useState(false)

  return <div className="tradingview-chart-wrap">
    {!failed && <iframe
      className="tradingview-widget-iframe"
      src={widgetUrl}
      title="Gráfico de Bitcoin a cuatro horas en TradingView"
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
      onError={() => setFailed(true)}
    />}
    {failed && <div className="chart-fallback" role="status">Gráfico no disponible. Mostramos la lectura de mercado sin datos simulados.</div>}
    <a className="tradingview-attribution" href="https://www.tradingview.com/symbols/BTCUSDT/" target="_blank" rel="noreferrer">Gráfico por TradingView</a>
  </div>
}
