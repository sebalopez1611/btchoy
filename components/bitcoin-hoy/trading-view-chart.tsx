'use client'

export function TradingViewChart() {
  return <div className="tradingview-chart-wrap">
    <div className="chart-fallback" role="status">
      <strong>Gráfico en vivo no disponible en esta vista previa.</strong>
      <span>Consulta el mercado directamente en TradingView.</span>
    </div>
    <a className="tradingview-attribution" href="https://www.tradingview.com/symbols/BTCUSDT/" target="_blank" rel="noreferrer">Abrir BTCUSDT en TradingView</a>
  </div>
}
