'use client';

import { BusSearch } from '@/components/bus-search';
import {
  decodePolyline,
  fetchBmtcData,
  formatClock,
  type BmtcData,
  type BmtcStop,
  type Coordinate,
} from '@/lib/bmtc';
import type { PickingInfo } from '@deck.gl/core';
import { TripsLayer } from '@deck.gl/geo-layers';
import { ScatterplotLayer } from '@deck.gl/layers';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { BusFront, LoaderCircle, Pause, Play, Search, Shuffle, X } from 'lucide-react';
import mapboxgl, { type GeoJSONSource, type Map as MapboxMap } from 'mapbox-gl';
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type RouteChoice = {
  key: string;
  shortName: string;
  longName: string;
  patternIds: number[];
};

type Path = {
  coordinates: Coordinate[];
  cumulative: number[];
  length: number;
};

type AnimatedTrip = {
  tripIndex: number;
  patternIndex: number;
  start: number;
  end: number;
  path: Path;
  timestamps: number[];
  color: [number, number, number];
};

type Selection =
  | { kind: 'bus'; tripIndex: number; patternIds: number[] }
  | { kind: 'route'; route: RouteChoice; patternIds: number[] }
  | { kind: 'stop'; stop: BmtcStop; patternIds: number[] };

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';
const MAP_STYLE = 'mapbox://styles/mapbox/dark-v11';
const BENGALURU_CENTER: Coordinate = [77.5946, 12.9716];
const PLAYBACK_SPEED = 120;
const INITIAL_SECONDS = 32_460;
const AMBIENT_SAMPLE_RATE = 9;
const TRAIL_SECONDS = 95;
const EMPTY_LINES: FeatureCollection<LineString> = { type: 'FeatureCollection', features: [] };
const EMPTY_STOPS: FeatureCollection<Point> = { type: 'FeatureCollection', features: [] };
const ROUTE_COLORS: Array<[number, number, number]> = [
  [125, 207, 255],
  [187, 154, 247],
  [102, 214, 172],
  [247, 118, 142],
  [245, 190, 92],
];

function distanceBetween(a: Coordinate, b: Coordinate) {
  const latitude = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const x = (b[0] - a[0]) * Math.cos(latitude);
  const y = b[1] - a[1];
  return Math.sqrt(x * x + y * y) * 111_320;
}

function buildPath(coordinates: Coordinate[]): Path {
  const cumulative = [0];
  for (let index = 1; index < coordinates.length; index += 1) {
    cumulative.push(cumulative[index - 1] + distanceBetween(coordinates[index - 1], coordinates[index]));
  }
  return { coordinates, cumulative, length: cumulative.at(-1) ?? 0 };
}

function pointAt(path: Path, progress: number): Coordinate {
  if (path.coordinates.length < 2) return path.coordinates[0] ?? BENGALURU_CENTER;
  const target = Math.max(0, Math.min(1, progress)) * path.length;
  let low = 0;
  let high = path.cumulative.length - 1;
  while (low < high - 1) {
    const middle = Math.floor((low + high) / 2);
    if (path.cumulative[middle] <= target) low = middle;
    else high = middle;
  }
  const start = path.coordinates[low];
  const end = path.coordinates[high] ?? start;
  const segment = path.cumulative[high] - path.cumulative[low];
  const fraction = segment > 0 ? (target - path.cumulative[low]) / segment : 0;
  return [start[0] + (end[0] - start[0]) * fraction, start[1] + (end[1] - start[1]) * fraction];
}

function routeColor(key: string): [number, number, number] {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) hash = Math.imul(31, hash) + key.charCodeAt(index) | 0;
  return ROUTE_COLORS[Math.abs(hash) % ROUTE_COLORS.length];
}

function makeAnimatedTrip(data: BmtcData, paths: Path[], tripIndex: number): AnimatedTrip | null {
  const trip = data.trips[tripIndex];
  const pattern = data.patterns[trip?.[0]];
  const path = paths[pattern?.[6]];
  if (!trip || !pattern || !path || path.coordinates.length < 2 || path.length <= 0) return null;
  const duration = trip[2] - trip[1];
  return {
    tripIndex,
    patternIndex: trip[0],
    start: trip[1],
    end: trip[2],
    path,
    timestamps: path.cumulative.map((distance) => trip[1] + distance / path.length * duration),
    color: routeColor(`${pattern[0]}:${pattern[1]}`),
  };
}

function isAmbientTrip(tripIndex: number) {
  return ((Math.imul(tripIndex + 1, 0x9e3779b1) >>> 0) % AMBIENT_SAMPLE_RATE) === 0;
}

function isHighlighted(trip: AnimatedTrip, selection: Selection | null) {
  if (!selection) return false;
  return selection.kind === 'bus' ? selection.tripIndex === trip.tripIndex : selection.patternIds.includes(trip.patternIndex);
}

function addSelectionLayers(map: MapboxMap) {
  map.addSource('selected-routes', { type: 'geojson', data: EMPTY_LINES });
  map.addLayer({
    id: 'selected-route-glow', type: 'line', source: 'selected-routes',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ff7a35', 'line-width': 8, 'line-opacity': 0.12, 'line-blur': 4 },
  });
  map.addLayer({
    id: 'selected-route', type: 'line', source: 'selected-routes',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ff7a35', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.5, 14, 3.2], 'line-opacity': 0.82 },
  });
  map.addSource('selected-stop', { type: 'geojson', data: EMPTY_STOPS });
  map.addLayer({
    id: 'selected-stop-glow', type: 'circle', source: 'selected-stop',
    paint: { 'circle-radius': 18, 'circle-color': '#ff7a35', 'circle-opacity': 0.16, 'circle-blur': 0.6 },
  });
  map.addLayer({
    id: 'selected-stop', type: 'circle', source: 'selected-stop',
    paint: { 'circle-radius': 5, 'circle-color': '#ff7a35', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.4 },
  });
}

function fitPaths(map: MapboxMap, paths: Path[]) {
  const bounds = new mapboxgl.LngLatBounds();
  for (const path of paths) for (const coordinate of path.coordinates) bounds.extend(coordinate);
  if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 90, maxZoom: 14, duration: 850 });
}

export default function Home() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const dataRef = useRef<BmtcData | null>(null);
  const pathsRef = useRef<Path[]>([]);
  const ambientTripsRef = useRef<AnimatedTrip[]>([]);
  const renderedTripsRef = useRef<AnimatedTrip[]>([]);
  const ambientTripIdsRef = useRef<Set<number>>(new Set());
  const secondsRef = useRef(INITIAL_SECONDS);
  const selectedRef = useRef<Selection | null>(null);
  const activeTripIdsRef = useRef<number[]>([]);
  const selectBusRef = useRef<(tripIndex: number, focus?: boolean) => void>(() => undefined);
  const pausedRef = useRef(false);
  const lastFrameRef = useRef(0);
  const lastDisplayRef = useRef(0);
  const lastCameraRef = useRef(0);

  const [data, setData] = useState<BmtcData | null>(null);
  const [displaySeconds, setDisplaySeconds] = useState(INITIAL_SECONDS);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(MAPBOX_TOKEN ? '' : 'Map unavailable.');
  const [searchOpen, setSearchOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  const renderTrips = useCallback((seconds = secondsRef.current) => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const trips = renderedTripsRef.current;
    const selectionNow = selectedRef.current;
    const active = trips.filter((trip) => trip.start <= seconds && trip.end >= seconds);
    activeTripIdsRef.current = active.map((trip) => trip.tripIndex);

    overlay.setProps({
      layers: [
        new TripsLayer<AnimatedTrip>({
          id: 'scheduled-trips',
          data: trips,
          getPath: (trip) => trip.path.coordinates,
          getTimestamps: (trip) => trip.timestamps,
          getColor: (trip) => isHighlighted(trip, selectionNow)
            ? [255, 122, 53, 235]
            : [trip.color[0], trip.color[1], trip.color[2], selectionNow ? 30 : 150],
          getWidth: (trip) => isHighlighted(trip, selectionNow) ? 3 : 1.4,
          widthMinPixels: 1.4,
          trailLength: TRAIL_SECONDS,
          currentTime: seconds,
          capRounded: true,
          jointRounded: true,
          opacity: 1,
          pickable: false,
          updateTriggers: { getColor: [selectionNow], getWidth: [selectionNow] },
        }),
        new ScatterplotLayer<AnimatedTrip>({
          id: 'bus-heads',
          data: active,
          getPosition: (trip) => pointAt(trip.path, (seconds - trip.start) / (trip.end - trip.start)),
          getRadius: (trip) => isHighlighted(trip, selectionNow) ? 4.2 : 2.15,
          getFillColor: (trip) => isHighlighted(trip, selectionNow)
            ? [255, 122, 53, 255]
            : [trip.color[0], trip.color[1], trip.color[2], selectionNow ? 65 : 245],
          radiusUnits: 'pixels',
          stroked: true,
          getLineColor: [255, 255, 255, 110],
          lineWidthMinPixels: 0.5,
          pickable: true,
          onClick: (info: PickingInfo<AnimatedTrip>) => {
            if (info.object) selectBusRef.current(info.object.tripIndex);
          },
          updateTriggers: {
            getPosition: [seconds],
            getFillColor: [selectionNow],
            getRadius: [selectionNow],
          },
        }),
      ],
    });
  }, []);

  const updateRenderedTrips = useCallback((next: Selection | null) => {
    const bmtc = dataRef.current;
    if (!bmtc) return;
    const paths = pathsRef.current;
    const ambientIds = ambientTripIdsRef.current;
    let extraIds: number[] = [];
    if (next?.kind === 'bus') extraIds = [next.tripIndex];
    if (next?.kind === 'route') {
      const patternIds = new Set(next.patternIds);
      bmtc.trips.forEach((trip, index) => { if (patternIds.has(trip[0])) extraIds.push(index); });
    }
    const extras = extraIds
      .filter((tripIndex) => !ambientIds.has(tripIndex))
      .map((tripIndex) => makeAnimatedTrip(bmtc, paths, tripIndex))
      .filter((trip): trip is AnimatedTrip => Boolean(trip));
    renderedTripsRef.current = [...ambientTripsRef.current, ...extras];
  }, []);

  const setMapSelection = useCallback((next: Selection | null, focus = true) => {
    selectedRef.current = next;
    setSelection(next);
    updateRenderedTrips(next);
    const map = mapRef.current;
    const source = map?.getSource('selected-routes') as GeoJSONSource | undefined;
    const stopSource = map?.getSource('selected-stop') as GeoJSONSource | undefined;
    const visiblePatternIds = next && next.kind !== 'stop' ? next.patternIds : [];
    const routePaths = [...new Set(visiblePatternIds.map((id) => dataRef.current?.patterns[id]?.[6]).filter((id): id is number => id !== undefined))]
      .map((shapeId) => pathsRef.current[shapeId]).filter(Boolean);
    source?.setData({
      type: 'FeatureCollection',
      features: routePaths.map((path): Feature<LineString> => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: path.coordinates } })),
    });
    stopSource?.setData(next?.kind === 'stop' ? {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [next.stop[3], next.stop[4]] } }],
    } : EMPTY_STOPS);
    if (focus && map) {
      if (next?.kind === 'stop') map.easeTo({ center: [next.stop[3], next.stop[4]], zoom: 14.5, duration: 750 });
      else if (next?.kind === 'bus') {
        const trip = dataRef.current?.trips[next.tripIndex];
        const pattern = trip ? dataRef.current?.patterns[trip[0]] : undefined;
        const path = pattern ? pathsRef.current[pattern[6]] : undefined;
        if (trip && path) {
          const position = pointAt(path, (secondsRef.current - trip[1]) / (trip[2] - trip[1]));
          lastCameraRef.current = performance.now() + 700;
          map.easeTo({ center: position, zoom: 13.6, pitch: 0, duration: 950 });
        }
      } else if (routePaths.length) fitPaths(map, routePaths);
    }
    renderTrips();
  }, [renderTrips, updateRenderedTrips]);

  const selectBus = useCallback((tripIndex: number, focus = true) => {
    const trip = dataRef.current?.trips[tripIndex];
    if (!trip) return;
    setMapSelection({ kind: 'bus', tripIndex, patternIds: [trip[0]] }, focus);
  }, [setMapSelection]);

  useEffect(() => {
    selectBusRef.current = selectBus;
  }, [selectBus]);

  useEffect(() => {
    if (!MAPBOX_TOKEN || !mapContainerRef.current || mapRef.current) return;
    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLE,
      center: BENGALURU_CENTER,
      zoom: 10.65,
      pitch: 28,
      bearing: -8,
      attributionControl: true,
      antialias: true,
    });
    mapRef.current = map;
    map.on('load', () => {
      addSelectionLayers(map);
      const overlay = new MapboxOverlay({ interleaved: true, layers: [] });
      overlayRef.current = overlay;
      map.addControl(overlay);
      renderTrips();
    });
    map.on('error', (event) => {
      if (String(event.error?.message ?? '').includes('401')) setError('Map unavailable.');
    });
    return () => { overlayRef.current = null; map.remove(); mapRef.current = null; };
  }, [renderTrips]);

  useEffect(() => {
    let cancelled = false;
    void fetchBmtcData()
      .then((next) => {
        if (cancelled) return;
        const paths = next.shapes.map((shape) => buildPath(decodePolyline(shape)));
        const ambientIds = new Set<number>();
        const ambient = next.trips
          .map((_, tripIndex) => {
            if (!isAmbientTrip(tripIndex)) return null;
            ambientIds.add(tripIndex);
            return makeAnimatedTrip(next, paths, tripIndex);
          })
          .filter((trip): trip is AnimatedTrip => Boolean(trip));
        dataRef.current = next;
        pathsRef.current = paths;
        ambientTripIdsRef.current = ambientIds;
        ambientTripsRef.current = ambient;
        renderedTripsRef.current = ambient;
        setData(next);
        setLoading(false);
        renderTrips();
      })
      .catch(() => { if (!cancelled) { setError('The BMTC schedule could not be loaded.'); setLoading(false); } });
    return () => { cancelled = true; };
  }, [renderTrips]);

  useEffect(() => {
    let animation = 0;
    const frame = (timestamp: number) => {
      const delta = lastFrameRef.current ? Math.min(timestamp - lastFrameRef.current, 100) : 0;
      lastFrameRef.current = timestamp;
      if (!pausedRef.current && dataRef.current) {
        secondsRef.current = (secondsRef.current + delta * PLAYBACK_SPEED / 1000) % 86_400;
        renderTrips();
      }
      const selected = selectedRef.current;
      if (selected?.kind === 'bus' && !pausedRef.current && timestamp - lastCameraRef.current > 250) {
        lastCameraRef.current = timestamp;
        const trip = dataRef.current?.trips[selected.tripIndex];
        const pattern = trip ? dataRef.current?.patterns[trip[0]] : undefined;
        const path = pattern ? pathsRef.current[pattern[6]] : undefined;
        if (trip && path && secondsRef.current <= trip[2]) {
          const position = pointAt(path, (secondsRef.current - trip[1]) / (trip[2] - trip[1]));
          mapRef.current?.easeTo({ center: position, duration: 270, easing: (value) => value });
        }
      }
      if (timestamp - lastDisplayRef.current > 160) {
        lastDisplayRef.current = timestamp;
        setDisplaySeconds(secondsRef.current);
      }
      animation = requestAnimationFrame(frame);
    };
    animation = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(animation);
  }, [renderTrips]);

  const togglePause = useCallback(() => {
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
  }, []);

  const randomBus = useCallback(() => {
    const bmtc = dataRef.current;
    if (!bmtc) return;
    const eligible = activeTripIdsRef.current.filter((tripIndex) => {
      const trip = bmtc.trips[tripIndex];
      return secondsRef.current < (trip[1] + trip[2]) / 2;
    });
    if (!eligible.length) return;
    selectBus(eligible[Math.floor(Math.random() * eligible.length)]);
  }, [selectBus]);

  const jumpToTime = useCallback((seconds: number) => {
    secondsRef.current = seconds;
    setDisplaySeconds(seconds);
    setMapSelection(null, false);
    renderTrips(seconds);
  }, [renderTrips, setMapSelection]);

  const selectRoute = useCallback((route: RouteChoice) => {
    setMapSelection({ kind: 'route', route, patternIds: route.patternIds });
  }, [setMapSelection]);

  const selectStop = useCallback((stop: BmtcStop) => {
    setMapSelection({ kind: 'stop', stop, patternIds: stop[5] });
  }, [setMapSelection]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return;
      if (event.code === 'Space') { event.preventDefault(); togglePause(); }
      if (event.key.toLowerCase() === 's') setSearchOpen(true);
      if (event.key.toLowerCase() === 'r') randomBus();
      if (event.key.toLowerCase() === 'a') setAboutOpen(true);
      if (event.key === 'Escape') { setSearchOpen(false); setAboutOpen(false); setMapSelection(null, false); }
    };
    addEventListener('keydown', onKeyDown);
    return () => removeEventListener('keydown', onKeyDown);
  }, [randomBus, setMapSelection, togglePause]);

  const selectedDetails = useMemo(() => {
    if (!selection || !data) return null;
    if (selection.kind === 'bus') {
      const trip = data.trips[selection.tripIndex];
      const pattern = data.patterns[trip[0]];
      return { eyebrow: 'scheduled bus', title: pattern[1], body: `${pattern[4]} → ${pattern[5]}`, meta: `${formatClock(trip[1])} — ${formatClock(trip[2])}` };
    }
    if (selection.kind === 'route') {
      return { eyebrow: 'BMTC route', title: selection.route.shortName, body: selection.route.longName, meta: `${selection.patternIds.length} scheduled patterns` };
    }
    const uniqueRoutes = new Set(selection.patternIds.map((id) => data.patterns[id]?.[1]).filter(Boolean));
    return { eyebrow: 'BMTC stop', title: selection.stop[1], body: selection.stop[2] || 'Bengaluru', meta: `${uniqueRoutes.size} routes stop here` };
  }, [data, selection]);

  return (
    <main className="traffic-app">
      <div ref={mapContainerRef} className="map" aria-label="Map of scheduled BMTC buses moving through Bengaluru" />
      <div className="map-vignette" />

      <nav className="hud-controls" aria-label="Playback controls">
        <button className="hud-button search-button" onClick={() => setSearchOpen(true)} title="Find a bus (S)"><Search /><span>Find a bus</span></button>
        <button className="hud-button icon-button" onClick={togglePause} aria-label={paused ? 'Play' : 'Pause'} title={`${paused ? 'Play' : 'Pause'} (Space)`}>{paused ? <Play /> : <Pause />}</button>
        <button className="hud-button icon-button" onClick={randomBus} aria-label="Random bus" title="Random bus (R)"><Shuffle /></button>
        {/* About stays available with the A key while its button is intentionally hidden. */}
      </nav>

      <div className="time-readout">
        <strong>{formatClock(displaySeconds)}</strong>
      </div>

      <section className="timeline hud" aria-label="Daily bus timeline">
        <span>12am</span>
        <input type="range" min="0" max="86399" step="60" value={Math.floor(displaySeconds)} onChange={(event) => jumpToTime(Number(event.target.value))} aria-label="Time of day" />
        <span>12am</span>
      </section>

      <div className="brand-mark">
        <h1>busuru</h1>
      </div>

      {selectedDetails && (
        <section className="hud ride-card bus-card">
          <button className="card-close" aria-label="Close details" onClick={() => setMapSelection(null, false)}><X /></button>
          <p><BusFront /> {selectedDetails.eyebrow}</p>
          <strong>{selectedDetails.title}</strong>
          <div className="bus-card-route">{selectedDetails.body}</div>
          <small>{selectedDetails.meta}</small>
        </section>
      )}

      {loading && <div className="loading-pill hud"><LoaderCircle /> loading Bengaluru</div>}
      {error && <div className="error-toast hud">{error}</div>}

      <footer>
        <a href="https://github.com/Vonter/bmtc-gtfs" target="_blank" rel="noreferrer">scheduled BMTC data · ODbL</a>
        <span>map · Mapbox</span>
      </footer>

      {aboutOpen && (
        <dialog className="about-backdrop" open aria-modal="true" aria-labelledby="about-title">
          <button className="modal-dismiss" aria-label="Close about" onClick={() => setAboutOpen(false)} />
          <section className="hud about-card">
            <button className="card-close" aria-label="Close about" onClick={() => setAboutOpen(false)}><X /></button>
            <p className="eyebrow">Bengaluru, scheduled</p>
            <h2 id="about-title">Every light is<br />a BMTC bus.</h2>
            <p>Busuru draws from {data?.index.scheduledTrips.toLocaleString() ?? '57,836'} scheduled trips across {data?.index.stops.toLocaleString() ?? '9,960'} stops. Search your route, find your stop, or follow a random bus through the city.</p>
            <p className="about-note">A representative sample is shown for clarity. Positions are reconstructed from the public timetable, not live GPS, and community-maintained timings may differ.</p>
          </section>
        </dialog>
      )}

      <BusSearch open={searchOpen} patterns={data?.patterns ?? []} stops={data?.stops ?? []} onClose={() => setSearchOpen(false)} onJumpToTime={jumpToTime} onSelectRoute={selectRoute} onSelectStop={selectStop} />
    </main>
  );
}
