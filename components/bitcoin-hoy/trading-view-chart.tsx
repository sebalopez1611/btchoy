export function TradingViewChart() {
  return <div className="tradingview-chart-wrap" aria-label="Gráfico real de Bitcoin en TradingView">
    <div className="chart-fallback" role="status">
      <strong>Gráfico BTC 4H disponible en TradingView</strong>
      <span>Consulta el gráfico interactivo en una ventana independiente.</span>
      <a href="https://www.tradingview.com/symbols/BTCUSD/" target="_blank" rel="noreferrer">Abrir TradingView</a>
    </div>
  </div>
}
