export type Coordinate = [number, number];

export type BmtcIndex = {
  routeRows: number;
  uniqueRoutes: number;
  scheduledTrips: number;
  stops: number;
  patterns: number;
  shapes: number;
  rawShapePoints: number;
  simplifiedShapePoints: number;
  peakActive: number;
  peakAt: number;
  feedStart: string;
  feedEnd: string;
  feedVersion: string;
  source: string;
};

export type BusPattern = [
  routeId: string,
  shortName: string,
  longName: string,
  headsign: string,
  origin: string,
  destination: string,
  shapeIndex: number,
  direction: number,
];

export type ScheduledTrip = [patternIndex: number, start: number, end: number];
export type BmtcStop = [
  id: string,
  name: string,
  description: string,
  longitude: number,
  latitude: number,
  patternIds: number[],
];

export type BmtcData = {
  index: BmtcIndex;
  shapes: string[];
  patterns: BusPattern[];
  trips: ScheduledTrip[];
  stops: BmtcStop[];
};

let dataPromise: Promise<BmtcData> | null = null;

export function fetchBmtcData() {
  if (!dataPromise) {
    dataPromise = Promise.all([
      fetch('/data/bmtc/index.json').then((response) => response.json() as Promise<BmtcIndex>),
      fetch('/data/bmtc/shapes.json').then((response) => response.json() as Promise<string[]>),
      fetch('/data/bmtc/patterns.json').then((response) => response.json() as Promise<BusPattern[]>),
      fetch('/data/bmtc/trips.json').then((response) => response.json() as Promise<ScheduledTrip[]>),
      fetch('/data/bmtc/stops.json').then((response) => response.json() as Promise<BmtcStop[]>),
    ]).then(([index, shapes, patterns, trips, stops]) => ({ index, shapes, patterns, trips, stops }));
  }
  return dataPromise;
}

export function decodePolyline(encoded: string): Coordinate[] {
  const points: Coordinate[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  const readValue = () => {
    let result = 0;
    let shift = 0;
    let byte = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };

  while (index < encoded.length) {
    latitude += readValue();
    longitude += readValue();
    points.push([longitude / 100_000, latitude / 100_000]);
  }
  return points;
}

export function formatClock(seconds: number) {
  const normalized = ((Math.floor(seconds) % 86_400) + 86_400) % 86_400;
  const hours = Math.floor(normalized / 3600);
  const minutes = Math.floor((normalized % 3600) / 60);
  const suffix = hours >= 12 ? 'pm' : 'am';
  const hour = hours % 12 || 12;
  return `${hour}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

export function secondsNowInIndia() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return (value('hour') % 24) * 3600 + value('minute') * 60 + value('second');
}
