'use client'

import { useEffect, useState } from 'react'
import { ArrowUpRight, BarChart3, ChevronRight, Eye, ExternalLink, Landmark, Newspaper, Settings2, Sparkles, X } from 'lucide-react'
import type { DailyData } from '@/lib/daily-types'
import { AFFILIATE_CONFIG, formatMoney, formatPercent } from '@/lib/daily-types'
import { TradingViewChart } from './trading-view-chart'

const cn = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')
const tone = (direction: string) => direction === 'positive' ? 'text-positive' : direction === 'negative' ? 'text-negative' : 'text-warning'
const safeHref = (url: string | null | undefined) => url && url !== '#' ? url : undefined
const fallback = (value: string | number | null | undefined, label = 'Sin datos') => value == null || value === '' ? label : value

export function LoadingState({ label = 'Cargando lectura' }: { label?: string }) { return <div className="state-block loading-state" role="status"><span className="state-pulse" />{label}</div> }
export function ErrorState({ label = 'No pudimos cargar esta lectura' }: { label?: string }) { return <div className="state-block error-state" role="alert"><span>!</span>{label}</div> }
export function EmptyState({ label = 'Sin datos disponibles' }: { label?: string }) { return <div className="state-block">{label}</div> }

export function DailyHero({ data }: { data: DailyData }) {
  const { market } = data
  const changeIsPositive = market.change24h != null && market.change24h >= 0
  return <section className="hero-shell reveal">
    <div className="eyebrow"><span className="brand-mark">₿</span><span>Bitcoin Hoy</span><span className="eyebrow-rule" /></div>
    <div className="hero-copy"><p className="kicker">Tu lectura diaria de Bitcoin</p><h1>La edición de<br /><em>hoy.</em></h1><p className="date-line">Lunes, 7 de septiembre <span>·</span> Actualizado hace 12 min</p></div>
    <div className="hero-market"><span className="price-label">BTC / USD</span><strong className="hero-price">{formatMoney(market.price)}</strong><div className="hero-change"><span className={cn('change-pill', market.change24h == null ? 'neutral-bg' : changeIsPositive ? 'positive-bg' : 'negative-bg')}>{formatPercent(market.change24h)}</span><span>en las últimas 24h</span></div></div>
    <div className="hero-stats">{[['Market Cap', formatMoney(market.marketCap, true)], ['Volumen 24h', formatMoney(market.volume24h, true)], ['Dominancia', market.dominance == null ? 'Sin datos' : `${market.dominance.toFixed(2)}%`], ['Fear & Greed', market.fearGreed == null ? 'Sin datos' : `${market.fearGreed} · ${market.fearGreedLabel || 'Sin etiqueta'}`]].map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b></div>)}</div>
    <a href="#edicion" className="scroll-cue"><span>↓</span> La edición de hoy</a>
  </section>
}

export function CatalystCard({ catalyst }: { catalyst: DailyData['catalyst'] }) {
  if (!catalyst) return <section className="section-block empty-block"><p className="section-label">Catalizador principal</p><EmptyState label="No hay catalizador disponible para esta edición." /></section>
  const href = safeHref(catalyst.url)
  return <section className="catalyst-card reveal"><div className="section-label accent-label"><Sparkles size={14} /> Catalizador principal</div>{href ? <a href={href} className="catalyst-title">{catalyst.title || 'Catalizador sin título'}<ArrowUpRight className="inline-icon" /></a> : <p className="catalyst-title">{catalyst.title || 'Catalizador sin título'}</p>}<div className="meta-line"><span>{catalyst.source || 'Fuente no disponible'}</span><span>·</span><span>{catalyst.ago || 'Sin hora'}</span>{href && <ExternalLink size={13} />}</div></section>
}

export function BitcoinChart() {
  return <div className="chart-panel"><div className="card-heading"><div><span className="section-label">Mercado</span><h2>BTC <span>· 4H</span></h2></div><span className="chart-live"><i /> Mercado en vivo</span></div><TradingViewChart /><div className="chart-legend"><span><i className="legend-orange" /> BTC / USDT</span><span>4 horas</span><span>Spot</span></div></div>
}

export function MarketBias({ bias }: { bias: DailyData['bias'] }) {
  if (!bias) return <div className="bias-card"><div className="card-heading"><div><span className="section-label">Lectura editorial</span><h2>Sesgo del mercado</h2></div><span className="bias-dot dot-neutral" /></div><div className="bias-status status-neutral"><span>—</span> Sesgo sin datos</div><EmptyState label="La lectura editorial aparecerá cuando haya señales suficientes." /></div>
  const isPositive = bias.key.includes('bullish'), isNegative = bias.key.includes('bearish'), status = isPositive ? 'positive' : isNegative ? 'negative' : 'neutral'
  return <div className={cn('bias-card', `bias-${status}`)}><div className="card-heading"><div><span className="section-label">Lectura editorial</span><h2>Sesgo del mercado</h2></div><span className={cn('bias-dot', `dot-${status}`)} /></div><div className={cn('bias-status', `status-${status}`)}><span aria-hidden="true">{isPositive ? '↑' : isNegative ? '↓' : '→'}</span><strong>{bias.label || 'Sin etiqueta'}</strong><small>{isPositive ? 'Presión compradora' : isNegative ? 'Presión vendedora' : 'Equilibrio de señales'}</small></div><div className="bias-confidence"><span>Lectura de hoy</span><b>{isPositive ? 'Constructiva' : isNegative ? 'Defensiva' : 'Mixta'}</b></div><div className="bias-lines"><div><span>Noticias</span><b>{fallback(bias.news)}</b></div><div><span>Institucionales</span><b>{fallback(bias.institutional)}</b></div><div><span>Traders</span><b>{fallback(bias.traders)}</b></div></div></div>
}

export function DailyChanges({ changes }: { changes: DailyData['changes'] }) {
  const visible = changes?.slice(0, 3) || []
  return <section className="section-block reveal" id="edicion"><div className="section-intro"><div><span className="section-number">01</span><h2>Qué cambió<br /><em>desde ayer</em></h2></div><p>La señal que merece tu atención antes de empezar el día.</p></div>{visible.length ? <><div className="changes-list">{visible.map((item) => <div className="change-row" key={item.id}><span className="change-name">{item.label || 'Sin etiqueta'}</span><div className="comparison"><span>{item.before || '—'}</span><ChevronRight size={16} /><b>{item.after || '—'}</b></div><span className={cn('direction', tone(item.direction))}>{item.direction === 'positive' ? '↑' : item.direction === 'negative' ? '↓' : '→'}</span></div>)}</div><div className="comparison-caption"><span>AYER</span><span className="caption-line" /><span>HOY</span></div></> : <EmptyState label="No hay cambios registrados desde ayer." />}</section>
}

const importanceLabel = { high: 'Alta', medium: 'Media', low: 'Baja' } as const
export function WatchToday({ watch }: { watch: DailyData['watch'] }) {
  const visible = watch?.slice(0, 3) || []
  return <section className="section-block reveal"><div className="section-intro compact"><div><span className="section-number">02</span><h2>Qué vigilar <em>hoy</em></h2></div><Eye size={20} /></div>{visible.length ? <div className="watch-grid">{visible.map((item, index) => { const level = item.importance || 'low'; return <div className={cn('watch-item', `watch-${level}`)} key={`${item.category}-${index}`}><div className="watch-topline"><span className="watch-index">0{index + 1}</span><span className="importance-badge" aria-label={`Importancia ${importanceLabel[level]}`}>{importanceLabel[level]}</span></div><span className="watch-category">{item.category || 'GENERAL'}</span><strong>{item.title || 'Sin título'}</strong><p>{item.detail || 'Sin detalle disponible.'}</p></div> })}</div> : <EmptyState label="No hay señales para vigilar hoy." />}</section>
}

const metric = (label: string, value: string, positive?: boolean) => <div className="metric"><span>{label}</span><b className={positive == null ? '' : positive ? 'text-positive' : 'text-negative'}>{value}</b></div>
export function ETFCard({ etf }: { etf: DailyData['etf'] }) { return <div className="data-card"><div className="card-heading"><div><span className="section-label"><Landmark size={14} /> Flujos institucionales</span><h2>ETF Spot Bitcoin</h2></div><ArrowUpRight size={18} /></div>{etf ? <div className="metric-grid">{metric('Último día', formatMoney(etf.lastDay, true), (etf.lastDay || 0) >= 0)}{metric('7 días', formatMoney(etf.days7, true), (etf.days7 || 0) >= 0)}{metric('30 días', formatMoney(etf.days30, true), (etf.days30 || 0) >= 0)}{metric('Cambio 30D', formatPercent(etf.change30d, 1), (etf.change30d || 0) >= 0)}</div> : <EmptyState />}</div> }
export function DerivativesCard({ derivatives }: { derivatives: DailyData['derivatives'] }) { return <div className="data-card"><div className="card-heading"><div><span className="section-label"><Settings2 size={14} /> Posicionamiento</span><h2>Derivados BTC</h2></div><BarChart3 size={18} /></div>{derivatives ? <div className="metric-grid">{metric('Funding', derivatives.funding == null ? 'Sin datos' : `${derivatives.funding.toFixed(4)}%`)}{metric('Open Interest', formatMoney(derivatives.openInterest, true))}{metric('Long / Short', derivatives.longPct == null || derivatives.shortPct == null ? 'Sin datos' : `${derivatives.longPct}% / ${derivatives.shortPct}%`)}{metric('Liquidaciones 24h', formatMoney(derivatives.liquidations24h, true))}</div> : <EmptyState />}</div> }

export function SecondaryNews({ news }: { news: DailyData['news'] }) { const visible = news?.slice(0, 2) || []; return <section className="section-block news-section reveal"><div className="section-intro compact"><div><span className="section-number">03</span><h2>Para completar<br /><em>el día</em></h2></div><Newspaper size={20} /></div>{visible.length ? <div className="news-list">{visible.map((item, index) => { const href = safeHref(item.url); return <a href={href || '#'} aria-disabled={!href} className={cn('news-item', !href && 'news-item-disabled')} key={`${item.title}-${index}`}><div><span>{item.source || 'Fuente no disponible'} <i>·</i> {item.ago || 'Sin hora'}</span><h3>{item.title || 'Noticia sin título'}</h3></div><ArrowUpRight size={18} /></a> })}</div> : <EmptyState label="No hay noticias secundarias disponibles." />}</section> }

export function AffiliateModal() { const [open, setOpen] = useState(false); useEffect(() => { try { const key = 'bitcoin-hoy-affiliate'; const raw = window.localStorage.getItem(key); const parsed = raw ? JSON.parse(raw) : {}; const state = { visitCount: Number(parsed.visitCount) || 0, affiliateDismissals: Number(parsed.affiliateDismissals) || 0 }; state.visitCount += 1; window.localStorage.setItem(key, JSON.stringify(state)); const timer = window.setTimeout(() => { if ([1, 3, 7].includes(state.visitCount)) setOpen(true) }, 22000); return () => window.clearTimeout(timer) } catch { return undefined } }, []); const close = () => { try { const raw = window.localStorage.getItem('bitcoin-hoy-affiliate'); const parsed = raw ? JSON.parse(raw) : {}; window.localStorage.setItem('bitcoin-hoy-affiliate', JSON.stringify({ ...parsed, affiliateDismissals: (Number(parsed.affiliateDismissals) || 0) + 1, lastAffiliateShown: Date.now() })) } catch { /* storage is optional */ } setOpen(false) }; if (!open) return null; return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="affiliate-title"><div className="affiliate-modal"><button className="modal-close" onClick={close} aria-label="Cerrar"><X size={18} /></button><div className="exchange-icon">{AFFILIATE_CONFIG.EXCHANGE_IMAGE}</div><span className="section-label">Una recomendación de Bitcoin Hoy</span><h2 id="affiliate-title">¿Todavía no tienes exchange?</h2><p>Opera Bitcoin con <strong>{AFFILIATE_CONFIG.EXCHANGE_NAME}</strong> y obtén los beneficios de nuestro código.</p><a href={AFFILIATE_CONFIG.AFFILIATE_URL || '#'} className="primary-cta" onClick={() => { close(); try { window.localStorage.setItem('bitcoin-hoy-affiliate-clicked', 'true') } catch { /* storage is optional */ } }}>Crear una cuenta <ArrowUpRight size={16} /></a><button className="secondary-cta" onClick={close}>Ahora no</button><small>Patrocinado · Podemos recibir una comisión si te registras mediante este enlace.</small></div></div> }

export function Footer() { return <footer><div className="footer-brand"><span className="brand-mark">₿</span><strong>Bitcoin Hoy</strong></div><p>Información educativa. No constituye asesoramiento financiero.</p><div className="sources"><span>Fuentes</span><span>CoinGecko</span><span>Xoomar</span><span>Alternative.me</span><span>CoinDesk</span><span>Cointelegraph</span><span>TradingView</span></div></footer> }
