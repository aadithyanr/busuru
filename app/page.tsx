'use client';

import { Button } from '@/components/ui/button';
import { Info, Pause, Play, Shuffle, X } from 'lucide-react';
import * as maplibregl from 'maplibre-gl';
import type { LngLatLike, Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const BENGALURU_CENTER: LngLatLike = [77.5946, 12.9716];
const TOMTOM_KEY = process.env.NEXT_PUBLIC_TOMTOM_API_KEY;

const HOTSPOTS = [
  [77.6227, 12.9177], // Silk Board
  [77.591, 13.0358], // Hebbal
  [77.6974, 12.9569], // Marathahalli
  [77.6966, 13.0077], // KR Puram
  [77.6697, 13.0056], // Tin Factory
] as const;

const PREVIEW_FLOW: GeoJSON.FeatureCollection<GeoJSON.LineString> = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'Outer Ring Road', traffic_level: 0.18, currentSpeed: 11, freeFlowSpeed: 43 },
      geometry: {
        type: 'LineString',
        coordinates: [
          [77.5839, 13.0412], [77.6147, 13.0237], [77.6507, 13.0101],
          [77.6879, 12.9957], [77.7003, 12.9568], [77.6808, 12.9251], [77.6229, 12.9175],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'Hosur Road', traffic_level: 0.42, currentSpeed: 19, freeFlowSpeed: 39 },
      geometry: { type: 'LineString', coordinates: [[77.5984, 12.965], [77.6051, 12.9445], [77.6229, 12.9175], [77.6389, 12.8838]] },
    },
    {
      type: 'Feature',
      properties: { name: 'Old Airport Road', traffic_level: 0.67, currentSpeed: 27, freeFlowSpeed: 40 },
      geometry: { type: 'LineString', coordinates: [[77.6128, 12.9716], [77.6413, 12.9592], [77.6747, 12.9585], [77.6974, 12.9569]] },
    },
    {
      type: 'Feature',
      properties: { name: 'Bellary Road', traffic_level: 0.82, currentSpeed: 42, freeFlowSpeed: 49 },
      geometry: { type: 'LineString', coordinates: [[77.5847, 12.986], [77.5903, 13.0358], [77.5942, 13.075]] },
    },
    {
      type: 'Feature',
      properties: { name: 'Mysore Road', traffic_level: 0.55, currentSpeed: 25, freeFlowSpeed: 44 },
      geometry: { type: 'LineString', coordinates: [[77.5845, 12.9631], [77.5524, 12.9564], [77.5142, 12.9457]] },
    },
  ],
};

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
    { id: 'background', type: 'background', paint: { 'background-color': '#08090b' } },
    {
      id: 'carto', type: 'raster', source: 'carto',
      paint: { 'raster-brightness-max': 0.64, 'raster-contrast': 0.12, 'raster-saturation': -0.35 },
    },
  ],
};

const TRAFFIC_COLOR: maplibregl.ExpressionSpecification = [
  'case', ['boolean', ['get', 'road_closure'], false], '#a8a8a8',
  ['interpolate', ['linear'], ['coalesce', ['get', 'traffic_level'], 1],
    0, '#ff3b30', 0.35, '#ff6b1a', 0.72, '#f4bd48', 1, '#39c781'],
];

type Segment = { name?: string; currentSpeed: number; freeFlowSpeed: number; roadClosure?: boolean };
type FlowResponse = { flowSegmentData?: Omit<Segment, 'name'> };

function addTrafficLayers(map: MapLibreMap, isPreview: boolean) {
  map.addSource('traffic-flow', isPreview
    ? { type: 'geojson', data: PREVIEW_FLOW }
    : {
        type: 'vector',
        tiles: [`https://api.tomtom.com/traffic/map/4/tile/flow/relative/{z}/{x}/{y}.pbf?key=${TOMTOM_KEY}`],
        minzoom: 0,
        maxzoom: 22,
      });
  const sourceLayer = isPreview ? {} : { 'source-layer': 'Traffic flow' };
  const width = ['interpolate', ['linear'], ['zoom'], 9, 1, 14, 3.2, 18, 7] as maplibregl.ExpressionSpecification;

  map.addLayer({
    id: 'traffic-glow', type: 'line', source: 'traffic-flow', ...sourceLayer,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': TRAFFIC_COLOR,
      'line-width': ['interpolate', ['linear'], ['zoom'], 9, 2.8, 14, 9, 18, 19.6],
      'line-opacity': 0.2,
      'line-blur': 7,
    },
  });
  map.addLayer({
    id: 'traffic-core', type: 'line', source: 'traffic-flow', ...sourceLayer,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': TRAFFIC_COLOR, 'line-width': width, 'line-opacity': 0.93 },
  });
  map.addLayer({
    id: 'traffic-motion', type: 'line', source: 'traffic-flow', ...sourceLayer,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#fff7e9',
      'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.45, 14, 1.2, 18, 2],
      'line-opacity': 0.28,
      'line-dasharray': [0.2, 2.2],
    },
  });
}

function formatTime(date: Date) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
  }).format(date);
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short',
  }).format(date);
}

export default function Home() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const animationRef = useRef<number | null>(null);
  const hotspotRef = useRef(0);
  const [now, setNow] = useState(() => new Date());
  const [playing, setPlaying] = useState(true);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [segment, setSegment] = useState<Segment | null>(null);
  const [loadingSegment, setLoadingSegment] = useState(false);
  const [trafficReady, setTrafficReady] = useState(false);
  const [trafficError, setTrafficError] = useState(false);
  const isPreview = !TOMTOM_KEY;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: BENGALURU_CENTER,
      zoom: 11.25,
      pitch: 42,
      bearing: -12,
      minZoom: 9.5,
      maxZoom: 17,
      maxBounds: [[77.35, 12.75], [77.85, 13.18]],
      attributionControl: false,
    });
    mapRef.current = map;
    map.on('load', () => {
      addTrafficLayers(map, isPreview);
      map.on('mouseenter', 'traffic-core', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'traffic-core', () => { map.getCanvas().style.cursor = ''; });
      if (isPreview) setTrafficReady(true);
    });
    map.on('sourcedata', (event) => {
      if (event.sourceId === 'traffic-flow' && event.isSourceLoaded) setTrafficReady(true);
    });
    map.on('error', (event) => {
      if (String(event.error?.message ?? '').toLowerCase().includes('traffic')) setTrafficError(true);
    });
    map.on('click', async (event) => {
      if (isPreview) {
        const properties = map.queryRenderedFeatures(event.point, { layers: ['traffic-core'] })[0]?.properties;
        if (properties?.currentSpeed && properties?.freeFlowSpeed) {
          setSegment({
            name: properties.name,
            currentSpeed: Number(properties.currentSpeed),
            freeFlowSpeed: Number(properties.freeFlowSpeed),
          });
        }
        return;
      }
      setLoadingSegment(true);
      try {
        const { lat, lng } = event.lngLat;
        const response = await fetch(
          `https://api.tomtom.com/traffic/services/4/flowSegmentData/relative0/${Math.round(map.getZoom())}/json?key=${TOMTOM_KEY}&point=${lat},${lng}&unit=kmph`,
        );
        if (!response.ok) throw new Error('Traffic segment unavailable');
        const flow = ((await response.json()) as FlowResponse).flowSegmentData;
        if (flow?.currentSpeed != null && flow.freeFlowSpeed != null) setSegment(flow);
      } catch {
        setSegment(null);
      } finally {
        setLoadingSegment(false);
      }
    });
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      map.remove();
      mapRef.current = null;
    };
  }, [isPreview]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !trafficReady) return;
    const patterns = [[0.15, 2.2], [0.4, 1.95], [0.7, 1.65], [1, 1.35], [1.3, 1.05], [1.6, 0.75], [1.9, 0.45]];
    let index = 0;
    let previous = 0;
    const animate = (timestamp: number) => {
      if (playing && timestamp - previous > 120) {
        index = (index + 1) % patterns.length;
        if (map.getLayer('traffic-motion')) map.setPaintProperty('traffic-motion', 'line-dasharray', patterns[index]);
        previous = timestamp;
      }
      animationRef.current = requestAnimationFrame(animate);
    };
    animationRef.current = requestAnimationFrame(animate);
    return () => { if (animationRef.current) cancelAnimationFrame(animationRef.current); };
  }, [playing, trafficReady]);

  const jumpToHotspot = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    hotspotRef.current = (hotspotRef.current + 1) % HOTSPOTS.length;
    setSegment(null);
    map.flyTo({
      center: HOTSPOTS[hotspotRef.current], zoom: 13.35, pitch: 48,
      bearing: hotspotRef.current % 2 ? 18 : -20, duration: 1700, essential: true,
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === ' ') { event.preventDefault(); setPlaying((value) => !value); }
      else if (event.key.toLowerCase() === 'r') jumpToHotspot();
      else if (event.key.toLowerCase() === 'a') setAboutOpen(true);
      else if (event.key === 'Escape') { setAboutOpen(false); setSegment(null); }
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

      <section className="hud hud-controls" aria-label="Map controls">
        <Button className="hud-button" onClick={() => setPlaying((value) => !value)}>
          {playing ? <Pause /> : <Play />}<span>{playing ? 'Pause' : 'Play'}</span><kbd>Space</kbd>
        </Button>
        <Button className="hud-button" onClick={jumpToHotspot}><Shuffle /><span>Random jam</span><kbd>R</kbd></Button>
        <Button className="hud-button" onClick={() => setAboutOpen(true)}><Info /><span>About</span><kbd>A</kbd></Button>
      </section>

      <section className="hud time-card" aria-label="Bengaluru time">
        <span>{formatDate(now)}</span><strong>{formatTime(now)}</strong>
      </section>

      <section className="hud live-card" aria-live="polite">
        <div className="live-row"><span className={`live-dot ${trafficReady ? 'is-live' : ''}`} /><strong>{trafficError ? 'Traffic unavailable' : !trafficReady ? 'Loading traffic' : isPreview ? 'Preview traffic' : 'Live traffic'}</strong></div>
        <div className="legend" aria-label="Traffic speed legend">
          <span><i className="legend-fast" />moving</span><span><i className="legend-slow" />slow</span><span><i className="legend-stuck" />pain</span>
        </div>
      </section>

      <header className="brand-block">
        <p>bengaluru · 12.9716° N, 77.5946° E</p><h1>cycleuru.</h1><span>watch bengaluru try to move.</span>
      </header>

      {(segment || loadingSegment) && (
        <section className="hud segment-card" aria-live="polite">
          <button aria-label="Close road details" onClick={() => setSegment(null)}><X /></button>
          {loadingSegment ? <p className="segment-loading">reading this road…</p> : segment ? <>
            <p>{segment.name ?? 'Traffic here'}</p>
            <div className="segment-speed"><strong>{segment.roadClosure ? 'closed' : `${segment.currentSpeed} km/h`}</strong>{!segment.roadClosure && <span>usually {segment.freeFlowSpeed}</span>}</div>
            {congestion != null && !segment.roadClosure && <small>moving at {congestion}% of free-flow speed</small>}
          </> : null}
        </section>
      )}

      <footer><span>traffic · TomTom</span><span>map · OpenStreetMap</span></footer>

      {aboutOpen && (
        <div className="about-backdrop" role="presentation" onClick={() => setAboutOpen(false)}>
          <section className="hud about-card" role="dialog" aria-modal="true" aria-labelledby="about-title" onClick={(event) => event.stopPropagation()}>
            <button aria-label="Close about" onClick={() => setAboutOpen(false)}><X /></button>
            <p className="eyebrow">About</p><h2 id="about-title">Bengaluru traffic,<br />without the honking.</h2>
            <p>A live portrait of how quickly—or painfully slowly—the city is moving right now.</p>
            <p className="about-note">Colours show current road speed relative to normal free-flow conditions. They are not individual vehicles.</p>
          </section>
        </div>
      )}
    </main>
  );
}
