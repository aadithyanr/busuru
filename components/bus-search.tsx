'use client';

import type { BmtcStop, BusPattern } from '@/lib/bmtc';
import { formatClock } from '@/lib/bmtc';
import * as chrono from 'chrono-node';
import { BusFront, Clock3, MapPin, Route, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

type RouteResult = {
  key: string;
  shortName: string;
  longName: string;
  patternIds: number[];
};

type Props = {
  open: boolean;
  patterns: BusPattern[];
  stops: BmtcStop[];
  onClose: () => void;
  onJumpToTime: (seconds: number) => void;
  onSelectRoute: (result: RouteResult) => void;
  onSelectStop: (stop: BmtcStop) => void;
};

function makeRouteResults(patterns: BusPattern[]) {
  const grouped = new Map<string, RouteResult>();
  patterns.forEach((pattern, patternId) => {
    const key = `${pattern[0]}:${pattern[1]}`;
    const result = grouped.get(key);
    if (result) result.patternIds.push(patternId);
    else grouped.set(key, { key, shortName: pattern[1], longName: pattern[2], patternIds: [patternId] });
  });
  return [...grouped.values()].sort((a, b) => a.shortName.localeCompare(b.shortName, undefined, { numeric: true }));
}

function parsedSeconds(query: string) {
  if (query.trim().length < 2) return null;
  const reference = new Date('2026-09-12T06:30:00+05:30');
  const result = chrono.parse(query, reference, { forwardDate: true })[0];
  if (!result || !result.start.isCertain('hour')) return null;
  const date = result.start.date();
  return date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
}

export function BusSearch({ open, patterns, stops, onClose, onJumpToTime, onSelectRoute, onSelectStop }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'route' | 'stop' | 'time'>('route');
  const [query, setQuery] = useState('');
  const routes = useMemo(() => makeRouteResults(patterns), [patterns]);
  const time = useMemo(() => mode === 'time' ? parsedSeconds(query) : null, [mode, query]);

  const routeMatches = useMemo(() => {
    if (mode !== 'route' || !query.trim()) return [];
    const needle = query.trim().toLowerCase();
    return routes
      .filter((route) => `${route.shortName} ${route.longName}`.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [mode, query, routes]);

  const stopMatches = useMemo(() => {
    if (mode !== 'stop' || query.trim().length < 2) return [];
    const needle = query.trim().toLowerCase();
    return stops
      .filter((stop) => `${stop[1]} ${stop[2]}`.toLowerCase().includes(needle))
      .sort((a, b) => {
        const score = (stop: BmtcStop) => stop[1].toLowerCase() === needle ? 0 : stop[1].toLowerCase().startsWith(needle) ? 1 : stop[1].toLowerCase().includes(needle) ? 2 : 3;
        return score(a) - score(b) || a[1].localeCompare(b[1]);
      })
      .slice(0, 8);
  }, [mode, query, stops]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, mode]);

  if (!open) return null;

  const switchMode = (next: 'route' | 'stop' | 'time') => {
    setMode(next);
    setQuery('');
  };

  return (
    <dialog className="search-backdrop" open aria-modal="true" aria-labelledby="bus-search-title">
      <button className="modal-dismiss" aria-label="Close search" onClick={onClose} />
      <section className="hud search-card">
        <button className="search-close" aria-label="Close search" onClick={onClose}><X /></button>
        <p className="eyebrow">Search Bengaluru</p>
        <h2 id="bus-search-title">Find your bus.<br />Watch it move.</h2>

        <div className="search-tabs" role="tablist">
          <button className={mode === 'route' ? 'active' : ''} onClick={() => switchMode('route')}><Route /> Route</button>
          <button className={mode === 'stop' ? 'active' : ''} onClick={() => switchMode('stop')}><MapPin /> Stop</button>
          <button className={mode === 'time' ? 'active' : ''} onClick={() => switchMode('time')}><Clock3 /> Time</button>
        </div>

        <div className="search-input-wrap">
          <Search />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose();
              if (event.key === 'Enter' && time !== null) { onJumpToTime(time); onClose(); }
            }}
            placeholder={mode === 'route' ? '500D, KIA-8…' : mode === 'stop' ? 'Silk Board, Indiranagar…' : '8:30 am, 6 pm…'}
            aria-label={`Search by ${mode}`}
            autoComplete="off"
          />
        </div>

        <div className="search-results" aria-live="polite">
          {routeMatches.map((route) => (
            <button key={route.key} onClick={() => { onSelectRoute(route); onClose(); }}>
              <BusFront />
              <span><strong>{route.shortName}</strong><small>{route.longName}</small></span>
              <em>{route.patternIds.length} ways</em>
            </button>
          ))}

          {stopMatches.map((stop) => (
            <button key={stop[0]} onClick={() => { onSelectStop(stop); onClose(); }}>
              <MapPin />
              <span><strong>{stop[1]}</strong><small>{stop[2] || `${stop[5].length} routes stop here`}</small></span>
              <em>{stop[5].length} routes</em>
            </button>
          ))}

          {mode === 'time' && time !== null && (
            <button onClick={() => { onJumpToTime(time); onClose(); }}>
              <Clock3 /><span><strong>Jump to {formatClock(time)}</strong><small>See the city scheduled at that moment</small></span>
            </button>
          )}

          {query && mode === 'route' && !routeMatches.length && <p>No matching BMTC route.</p>}
          {query.length >= 2 && mode === 'stop' && !stopMatches.length && <p>No matching BMTC stop.</p>}
          {query.length >= 2 && mode === 'time' && time === null && <p>Try a time like “8:30 am”.</p>}
        </div>

        {!query && <small className="search-hint">Try 500D, Silk Board, or 8:30 am.</small>}
      </section>
    </dialog>
  );
}
