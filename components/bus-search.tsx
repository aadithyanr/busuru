'use client';

import type { BmtcStop, BusPattern } from '@/lib/bmtc';
import { formatClock } from '@/lib/bmtc';
import * as chrono from 'chrono-node';
import { Clock3, MapPin, Route, Search, X } from 'lucide-react';
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

const FEATURED_STOPS = [
  { id: '21177', label: 'HSR Layout' },
  { id: '22390', label: 'Indiranagar' },
  { id: '21275', label: 'Koramangala' },
  { id: '20866', label: 'Whitefield' },
  { id: '21934', label: 'Electronic City' },
  { id: '20999', label: 'Manyata Tech Park' },
] as const;

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
  const [query, setQuery] = useState('');
  const routes = useMemo(() => makeRouteResults(patterns), [patterns]);
  const time = useMemo(() => parsedSeconds(query), [query]);

  const featuredStops = useMemo(() => FEATURED_STOPS
    .flatMap((featured) => {
      const stop = stops.find((candidate) => candidate[0] === featured.id);
      return stop ? [{ ...featured, stop }] : [];
    }), [stops]);

  const routeMatches = useMemo(() => {
    if (!query.trim()) return [];
    const needle = query.trim().toLowerCase();
    return routes
      .filter((route) => `${route.shortName} ${route.longName}`.toLowerCase().includes(needle))
      .sort((a, b) => {
        const score = (route: RouteResult) => route.shortName.toLowerCase() === needle
          ? 0
          : route.shortName.toLowerCase().startsWith(needle)
            ? 1
            : 2;
        return score(a) - score(b) || a.shortName.localeCompare(b.shortName, undefined, { numeric: true });
      })
      .slice(0, 4);
  }, [query, routes]);

  const stopMatches = useMemo(() => {
    if (query.trim().length < 2) return [];
    const needle = query.trim().toLowerCase();
    return stops
      .filter((stop) => `${stop[1]} ${stop[2]}`.toLowerCase().includes(needle))
      .sort((a, b) => {
        const score = (stop: BmtcStop) => stop[1].toLowerCase() === needle
          ? 0
          : stop[1].toLowerCase().startsWith(needle)
            ? 1
            : stop[1].toLowerCase().includes(needle)
              ? 2
              : 3;
        return score(a) - score(b) || b[5].length - a[5].length || a[1].localeCompare(b[1]);
      })
      .slice(0, 5);
  }, [query, stops]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  if (!open) return null;

  const chooseTime = () => {
    if (time === null) return;
    onJumpToTime(time);
    onClose();
  };

  const chooseFirstResult = () => {
    if (time !== null) return chooseTime();
    if (stopMatches[0]) {
      onSelectStop(stopMatches[0]);
      onClose();
      return;
    }
    if (routeMatches[0]) {
      onSelectRoute(routeMatches[0]);
      onClose();
    }
  };

  const hasResults = time !== null || stopMatches.length > 0 || routeMatches.length > 0;

  return (
    <dialog className="search-backdrop" open aria-modal="true" aria-labelledby="bus-search-title">
      <button className="modal-dismiss" aria-label="Close search" onClick={onClose} />
      <section className="hud search-card">
        <h2 className="sr-only" id="bus-search-title">Find a BMTC route, stop, neighbourhood, or time</h2>

        <div className="search-input-wrap">
          <Search />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose();
              if (event.key === 'Enter') chooseFirstResult();
            }}
            placeholder="Route, stop, neighbourhood or time…"
            aria-label="Search BMTC routes, stops, neighbourhoods, or times"
            autoComplete="off"
          />
          <button className="search-close" aria-label="Close search" onClick={onClose}><X /></button>
        </div>

        {!query && (
          <div className="search-examples">
            <p>Popular tech hubs</p>
            <div>
              {featuredStops.map((featured) => (
                <button key={featured.id} onClick={() => { onSelectStop(featured.stop); onClose(); }}>
                  <MapPin />
                  <span>{featured.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {query && (
          <div className="search-results" aria-live="polite">
            {time !== null && (
              <button onClick={chooseTime}>
                <Clock3 />
                <span><strong>{formatClock(time)}</strong><small>Jump to this time</small></span>
                <em>time</em>
              </button>
            )}

            {stopMatches.map((stop) => (
              <button key={stop[0]} onClick={() => { onSelectStop(stop); onClose(); }}>
                <MapPin />
                <span><strong>{stop[1]}</strong><small>{stop[2] || `${stop[5].length} routes stop here`}</small></span>
                <em>stop</em>
              </button>
            ))}

            {routeMatches.map((route) => (
              <button key={route.key} onClick={() => { onSelectRoute(route); onClose(); }}>
                <Route />
                <span><strong>{route.shortName}</strong><small>{route.longName}</small></span>
                <em>route</em>
              </button>
            ))}

            {query.length >= 2 && !hasResults && <p>No route or stop found.</p>}
          </div>
        )}
      </section>
    </dialog>
  );
}
