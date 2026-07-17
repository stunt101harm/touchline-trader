// Live market chart — lightweight-charts kept entirely outside React state.
// Ticks arrive via an imperative handle; flushed through requestAnimationFrame by the replay loop already,
// so each onTick call is at most once per frame.
import { useEffect, useImperativeHandle, useRef, forwardRef } from 'react';
import { createChart, type IChartApi, type ISeriesApi, type UTCTimestamp, LineStyle } from 'lightweight-charts';
import type { MatchEvent, Tick } from '../shared/types';

export interface ChartHandle {
  pushTick(tick: Tick): void;
  addEventMarker(ev: MatchEvent, homeName: string, awayName: string): void;
  /** Pin the visible range to the full match story so the whole arc stays on screen. */
  setStoryRange(t0Ms: number, t1Ms: number): void;
  reset(): void;
}

const COLORS = { home: '#4f8ff7', draw: '#8b93a3', away: '#f7644f' };

export const MarketChart = forwardRef<ChartHandle, { focus: 'home' | 'draw' | 'away' }>(function MarketChart({ focus }, ref) {
  const div = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<Record<'home' | 'draw' | 'away', ISeriesApi<'Line'> | null>>({ home: null, draw: null, away: null });
  const markers = useRef<{ time: UTCTimestamp; position: 'aboveBar'; color: string; shape: 'circle'; text: string }[]>([]);
  const lastSec = useRef<number>(0);
  const pendingRange = useRef<{ from: UTCTimestamp; to: UTCTimestamp } | null>(null);
  const rangeApplied = useRef(false);

  useEffect(() => {
    if (!div.current) return;
    const c = createChart(div.current, {
      layout: { background: { color: 'transparent' }, textColor: '#5c6470', fontSize: 10, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.08 } },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 3 },
      handleScroll: false,
      handleScale: false,
      crosshair: { vertLine: { visible: false }, horzLine: { visible: false } },
      autoSize: true,
    });
    for (const k of ['draw', 'away', 'home'] as const) {
      series.current[k] = c.addLineSeries({
        color: COLORS[k],
        lineWidth: k === focus ? 3 : 1,
        priceLineVisible: k === focus,
        lastValueVisible: true,
        crosshairMarkerVisible: false,
        lineStyle: k === 'draw' ? LineStyle.Dotted : LineStyle.Solid,
      });
    }
    chart.current = c;
    return () => { c.remove(); chart.current = null; };
  }, []);

  useEffect(() => {
    for (const k of ['home', 'draw', 'away'] as const) {
      series.current[k]?.applyOptions({ lineWidth: k === focus ? 3 : 1, priceLineVisible: k === focus });
    }
  }, [focus]);

  useImperativeHandle(ref, () => ({
    pushTick(tick: Tick) {
      const sec = Math.floor(tick.t / 1000) as UTCTimestamp;
      lastSec.current = sec;
      series.current.home?.update({ time: sec, value: tick.p[0] });
      series.current.draw?.update({ time: sec, value: tick.p[1] });
      series.current.away?.update({ time: sec, value: tick.p[2] });
      if (!rangeApplied.current && pendingRange.current) {
        try { chart.current?.timeScale().setVisibleRange(pendingRange.current); rangeApplied.current = true; } catch { /* not ready yet */ }
      }
    },
    addEventMarker(ev: MatchEvent, homeName: string, awayName: string) {
      // Only high-drama events get chart markers — yellows/VAR/subs stay in the toast feed.
      const icons: Partial<Record<MatchEvent['kind'], string>> = {
        goal: '⚽', red_card: '🟥', halftime: 'HT', fulltime: 'FT',
      };
      const icon = icons[ev.kind];
      if (!icon) return;
      const team = ev.kind === 'goal' ? (ev.team === 1 ? homeName : ev.team === 2 ? awayName : '') : '';
      markers.current.push({
        time: Math.floor(ev.t / 1000) as UTCTimestamp,
        position: 'aboveBar',
        color: ev.kind === 'goal' ? '#ffd75e' : ev.kind === 'red_card' ? '#ff5c5c' : '#5c6470',
        shape: 'circle',
        text: `${icon}${team ? ' ' + team : ''}`,
      });
      series.current.home?.setMarkers(markers.current as any);
    },
    setStoryRange(t0Ms: number, t1Ms: number) {
      pendingRange.current = {
        from: Math.floor(t0Ms / 1000) as UTCTimestamp,
        to: Math.ceil(t1Ms / 1000) as UTCTimestamp,
      };
      rangeApplied.current = false;
      try {
        chart.current?.timeScale().setVisibleRange(pendingRange.current);
        rangeApplied.current = true;
      } catch { /* applied on first tick instead */ }
    },
    reset() {
      markers.current = [];
      lastSec.current = 0;
      for (const k of ['home', 'draw', 'away'] as const) series.current[k]?.setData([]);
      series.current.home?.setMarkers([]);
    },
  }), []);

  return <div ref={div} className="chart" />;
});
