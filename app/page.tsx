'use client';

import { Button } from '@/components/ui/button';
import { Info, LocateFixed, Pause, Play, X } from 'lucide-react';
import * as maplibregl from 'maplibre-gl';
import type { Feature, FeatureCollection, GeoJsonProperties, Geometry, LineString, Point } from 'geojson';
import type { GeoJSONFeature, GeoJSONSource, Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Coordinate = [number, number];
type Segment = { name?: string; currentSpeed: number; freeFlowSpeed: number; roadClosure?: boolean };
type FlowResponse = { flowSegmentData?: Omit<Segment, 'name'> };
type TrafficState = 'loading' | 'live' | 'offline';
type TrafficStats = { flow: number; roads: number };
type RoadPath = {
  coordinates: Coordinate[];
  cumulative: number[];
  length: number;
  ratio: number;
  offset: number;
  reverse: boolean;
};

const BENGALURU_CENTER: Coordinate = [77.609, 12.972];
const HOTSPOTS: Coordinate[] = [
  [77.6227, 12.9177],
  [77.591, 13.0358],
  [77.6974, 12.9569],
  [77.6966, 13.0077],
  [77.6697, 13.0056],
];

const EMPTY_PARTICLES: FeatureCollection = { type: 'FeatureCollection', features: [] };

const MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    carto: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
      ],
      tileSize: 512,
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#111315' } },
    {
      id: 'carto',
      type: 'raster',
      source: 'carto',
      paint: {
        'raster-brightness-min': 0.06,
        'raster-brightness-max': 0.48,
        'raster-contrast': -0.08,
        'raster-saturation': -0.82,
      },
    },
  ],
};

const FLOW_COLOR: maplibregl.ExpressionSpecification = [
  'interpolate', ['linear'], ['coalesce', ['get', 'traffic_level'], 1],
  0, '#ff7180', 0.32, '#ffb45e', 0.68, '#9ce6bd', 1, '#7dcfff',
];

const PARTICLE_COLOR: maplibregl.ExpressionSpecification = [
  'interpolate', ['linear'], ['get', 'ratio'],
  0, '#ff7180', 0.32, '#ffb45e', 0.68, '#9ce6bd', 1, '#7dcfff',
];

function addTrafficLayers(map: MapLibreMap) {
  map.addSource('traffic-flow', {
    type: 'vector',
    tiles: ['/api/traffic/tiles/{z}/{x}/{y}'],
    minzoom: 0,
    maxzoom: 22,
  });

  map.addLayer({
    id: 'traffic-roads',
    type: 'line',
    source: 'traffic-flow',
    'source-layer': 'Traffic flow',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': FLOW_COLOR,
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.65, 14, 1.5, 17, 3],
      'line-opacity': ['interpolate', ['linear'], ['coalesce', ['get', 'traffic_level'], 1], 0, 0.56, 1, 0.12],
    },
  });

  map.addLayer({
    id: 'traffic-hit',
    type: 'line',
    source: 'traffic-flow',
    'source-layer': 'Traffic flow',
    paint: { 'line-color': '#000000', 'line-width': 14, 'line-opacity': 0 },
  });

  map.addSource('traffic-particles', { type: 'geojson', data: EMPTY_PARTICLES });
  map.addLayer({
    id: 'particle-trails',
    type: 'line',
    source: 'traffic-particles',
    filter: ['==', ['geometry-type'], 'LineString'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': PARTICLE_COLOR,
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.1, 14, 2.4, 17, 4],
      'line-opacity': 0.68,
      'line-blur': 0.35,
    },
  });
  map.addLayer({
    id: 'particle-glow',
    type: 'circle',
    source: 'traffic-particles',
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3, 14, 5.5, 17, 8],
      'circle-color': PARTICLE_COLOR,
      'circle-opacity': 0.18,
      'circle-blur': 0.7,
    },
  });
  map.addLayer({
    id: 'particle-heads',
    type: 'circle',
    source: 'traffic-particles',
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 1, 14, 1.8, 17, 2.8],
      'circle-color': PARTICLE_COLOR,
      'circle-opacity': 0.96,
      'circle-stroke-width': 0.7,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-opacity': 0.42,
    },
  });
}

function distanceBetween(a: Coordinate, b: Coordinate) {
  const latitude = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const x = (b[0] - a[0]) * Math.cos(latitude);
  const y = b[1] - a[1];
  return Math.sqrt(x * x + y * y) * 111_320;
}

function pointAtDistance(path: RoadPath, distance: number) {
  const target = Math.max(0, Math.min(distance, path.length));
  let index = 0;
  while (index < path.cumulative.length - 2 && path.cumulative[index + 1] < target) index += 1;
  const start = path.coordinates[index];
  const end = path.coordinates[index + 1] ?? start;
  const segmentLength = path.cumulative[index + 1] - path.cumulative[index];
  const fraction = segmentLength > 0 ? (target - path.cumulative[index]) / segmentLength : 0;
  return [start[0] + (end[0] - start[0]) * fraction, start[1] + (end[1] - start[1]) * fraction] as Coordinate;
}

function buildRoadPaths(features: GeoJSONFeature[]) {
  const paths: RoadPath[] = [];
  const seen = new Set<string>();

  const addLine = (coordinates: Coordinate[], ratio: number) => {
    if (coordinates.length < 2) return;
    const first = coordinates[0];
    const last = coordinates[coordinates.length - 1];
    const key = `${first[0].toFixed(4)}:${first[1].toFixed(4)}:${last[0].toFixed(4)}:${last[1].toFixed(4)}:${coordinates.length}`;
    if (seen.has(key)) return;
    seen.add(key);

    const cumulative = [0];
    for (let index = 1; index < coordinates.length; index += 1) {
      cumulative.push(cumulative[index - 1] + distanceBetween(coordinates[index - 1], coordinates[index]));
    }
    const length = cumulative[cumulative.length - 1];
    if (length < 90) return;
    const seed = paths.length * 0.61803398875;
    paths.push({
      coordinates,
      cumulative,
      length,
      ratio,
      offset: seed - Math.floor(seed),
      reverse: paths.length % 3 === 0,
    });
  };

  for (const feature of features) {
    const ratio = Math.max(0.05, Math.min(1, Number(feature.properties?.traffic_level ?? 1)));
    const geometry = feature.geometry as Geometry;
    if (geometry.type === 'LineString') addLine(geometry.coordinates as Coordinate[], ratio);
    if (geometry.type === 'MultiLineString') {
      for (const line of geometry.coordinates as Coordinate[][]) addLine(line, ratio);
    }
  }
  return paths;
}

function particleData(paths: RoadPath[], timestamp: number): FeatureCollection<Geometry, GeoJsonProperties> {
  const features: Feature<LineString | Point, { ratio: number }>[] = [];
  const selected = paths.slice(0, 260);

  for (const path of selected) {
    const metresPerSecond = 3 + path.ratio * 24;
    const travelled = ((timestamp / 1000) * metresPerSecond + path.offset * path.length) % path.length;
    const distance = path.reverse ? path.length - travelled : travelled;
    const trailLength = 18 + path.ratio * 55;
    const tailDistance = path.reverse ? Math.min(path.length, distance + trailLength) : Math.max(0, distance - trailLength);
    const head = pointAtDistance(path, distance);
    const tail = pointAtDistance(path, tailDistance);
    features.push({ type: 'Feature', properties: { ratio: path.ratio }, geometry: { type: 'LineString', coordinates: [tail, head] } });
    features.push({ type: 'Feature', properties: { ratio: path.ratio }, geometry: { type: 'Point', coordinates: head } });
  }

  return { type: 'FeatureCollection', features };
}

function formatTime(date: Date) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
  }).format(date);
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  }).format(date);
}

export default function Home() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const pathsRef = useRef<RoadPath[]>([]);
  const animationRef = useRef<number | null>(null);
  const hotspotRef = useRef(0);
  const playingRef = useRef(true);
  const lastFrameRef = useRef(0);
  const pausedAtRef = useRef(0);
  const pauseStartedRef = useRef<number | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [playing, setPlaying] = useState(true);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [segment, setSegment] = useState<Segment | null>(null);
  const [loadingSegment, setLoadingSegment] = useState(false);
  const [trafficState, setTrafficState] = useState<TrafficState>('loading');
  const [stats, setStats] = useState<TrafficStats | null>(null);

  useEffect(() => {
    const firstFrame = window.requestAnimationFrame(() => setNow(new Date()));
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    playingRef.current = playing;
    if (playing) {
      if (pauseStartedRef.current != null) pausedAtRef.current += performance.now() - pauseStartedRef.current;
      pauseStartedRef.current = null;
    } else if (pauseStartedRef.current == null) {
      pauseStartedRef.current = performance.now();
    }
  }, [playing]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: BENGALURU_CENTER,
      zoom: 12.45,
      pitch: 0,
      bearing: 0,
      minZoom: 10,
      maxZoom: 17,
      maxBounds: [[77.35, 12.75], [77.85, 13.18]],
      attributionControl: false,
    });
    mapRef.current = map;

    const collectRoads = () => {
      if (!map.getSource('traffic-flow') || !map.isSourceLoaded('traffic-flow')) return;
      const features = map.querySourceFeatures('traffic-flow', { sourceLayer: 'Traffic flow' });
      const paths = buildRoadPaths(features);
      if (paths.length === 0) return;
      paths.sort((a, b) => a.offset - b.offset);
      pathsRef.current = paths;
      const average = paths.reduce((sum, path) => sum + path.ratio, 0) / paths.length;
      setStats({ flow: Math.round(average * 100), roads: paths.length });
      setTrafficState('live');
    };

    const animate = (timestamp: number) => {
      if (playingRef.current && timestamp - lastFrameRef.current > 42 && pathsRef.current.length > 0) {
        const source = map.getSource('traffic-particles') as GeoJSONSource | undefined;
        const animationTime = timestamp - pausedAtRef.current;
        void source?.setData(particleData(pathsRef.current, animationTime));
        lastFrameRef.current = timestamp;
      }
      animationRef.current = window.requestAnimationFrame(animate);
    };

    const offlineTimer = window.setTimeout(() => {
      if (pathsRef.current.length === 0) setTrafficState('offline');
    }, 9000);

    map.on('load', () => {
      addTrafficLayers(map);
      map.on('idle', collectRoads);
      map.on('moveend', collectRoads);
      map.on('mouseenter', 'traffic-hit', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'traffic-hit', () => { map.getCanvas().style.cursor = ''; });
      animationRef.current = window.requestAnimationFrame(animate);
    });

    map.on('click', async (event) => {
      const road = map.queryRenderedFeatures(event.point, { layers: ['traffic-hit'] })[0];
      if (!road) return;
      setLoadingSegment(true);
      try {
        const { lat, lng } = event.lngLat;
        const response = await fetch(`/api/traffic/segment?lat=${lat}&lng=${lng}&zoom=${Math.round(map.getZoom())}`);
        if (!response.ok) throw new Error('Traffic segment unavailable');
        const flow = ((await response.json()) as FlowResponse).flowSegmentData;
        if (flow?.currentSpeed != null && flow.freeFlowSpeed != null) {
          setSegment({ ...flow, name: String(road.properties?.road_type ?? 'This road') });
        }
      } catch {
        setSegment(null);
      } finally {
        setLoadingSegment(false);
      }
    });

    map.on('error', (event) => {
      if (String(event.error?.message ?? '').toLowerCase().includes('traffic')) setTrafficState('offline');
    });

    return () => {
      window.clearTimeout(offlineTimer);
      if (animationRef.current) window.cancelAnimationFrame(animationRef.current);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  const jumpToHotspot = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const hotspot = HOTSPOTS[hotspotRef.current % HOTSPOTS.length];
    hotspotRef.current += 1;
    setSegment(null);
    map.flyTo({ center: hotspot, zoom: 13.5, pitch: 0, bearing: 0, duration: 1500, essential: true });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === ' ') {
        event.preventDefault();
        setPlaying((value) => !value);
      } else if (event.key.toLowerCase() === 'r') jumpToHotspot();
      else if (event.key.toLowerCase() === 'a') setAboutOpen(true);
      else if (event.key === 'Escape') {
        setAboutOpen(false);
        setSegment(null);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [jumpToHotspot]);

  const congestion = useMemo(() => {
    if (!segment || segment.freeFlowSpeed <= 0) return null;
    return Math.max(0, Math.min(100, Math.round((segment.currentSpeed / segment.freeFlowSpeed) * 100)));
  }, [segment]);

  return (
    <main className="traffic-app">
      <div ref={containerRef} className="map" aria-label="Live Bengaluru traffic map" />
      <div className="map-vignette" aria-hidden="true" />

      <section className="hud-controls" aria-label="Map controls">
        <Button className="hud-button" onClick={() => setPlaying((value) => !value)}>
          {playing ? <Pause /> : <Play />}<span>{playing ? 'Pause' : 'Play'}</span><kbd>Space</kbd>
        </Button>
        <Button className="hud-button" onClick={jumpToHotspot}><LocateFixed /><span>Find a jam</span><kbd>R</kbd></Button>
        <Button className="hud-button" onClick={() => setAboutOpen(true)}><Info /><span>About</span><kbd>A</kbd></Button>
      </section>

      <section className="hud time-card" aria-label="Bengaluru time">
        <span>{now ? formatDate(now) : 'Bengaluru'}</span>
        <strong>{now ? formatTime(now) : '--:--:--'}</strong>
      </section>

      <section className="hud flow-card" aria-live="polite">
        <div className="flow-heading"><strong>{stats ? stats.flow : '--'}</strong><span>%</span></div>
        <p>{trafficState === 'offline' ? 'SIGNAL LOST' : 'CITY FLOW'}</p>
        <div className="flow-scale" aria-hidden="true"><i /><i /><i /><i /><i /></div>
        <small>{stats ? `${stats.roads.toLocaleString('en-IN')} live road samples` : trafficState === 'loading' ? 'reading the city…' : 'trying again soon'}</small>
      </section>

      <header className="brand-mark">
        <h1>cycleuru</h1>
        <span><i className={trafficState === 'live' ? 'is-live' : ''} /> Bengaluru, live</span>
      </header>

      {(segment || loadingSegment) && (
        <section className="hud segment-card" aria-live="polite">
          <button aria-label="Close road details" onClick={() => setSegment(null)}><X /></button>
          {loadingSegment ? <p className="segment-loading">reading this road…</p> : segment ? <>
            <p>{segment.name ?? 'This road'}</p>
            <div className="segment-speed"><strong>{segment.roadClosure ? 'closed' : `${segment.currentSpeed} km/h`}</strong>{!segment.roadClosure && <span>usually {segment.freeFlowSpeed}</span>}</div>
            {congestion != null && !segment.roadClosure && <small>{congestion}% of free-flow speed</small>}
          </> : null}
        </section>
      )}

      <footer><span>traffic · TomTom</span><span>map · OpenStreetMap</span></footer>

      {aboutOpen && (
        <dialog className="about-backdrop" open aria-modal="true" aria-labelledby="about-title">
          <section className="hud about-card">
            <button aria-label="Close about" onClick={() => setAboutOpen(false)}><X /></button>
            <p className="eyebrow">Cycleuru</p>
            <h2 id="about-title">Bengaluru,<br />trying to move.</h2>
            <p>Every moving streak is a live traffic-flow sample. Its pace follows how quickly that road is moving compared with normal free-flow conditions.</p>
            <p className="about-note">The streaks visualize traffic samples, not individual vehicles.</p>
          </section>
        </dialog>
      )}
    </main>
  );
}
