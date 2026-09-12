const isCoordinate = (value: number, min: number, max: number) => Number.isFinite(value) && value >= min && value <= max;

export async function GET(request: Request) {
  const key = process.env.TOMTOM_API_KEY ?? process.env.NEXT_PUBLIC_TOMTOM_API_KEY;
  if (!key) return Response.json({ error: 'Traffic unavailable' }, { status: 503 });

  const url = new URL(request.url);
  const latitude = Number(url.searchParams.get('lat'));
  const longitude = Number(url.searchParams.get('lng'));
  const zoom = Math.max(0, Math.min(22, Math.round(Number(url.searchParams.get('zoom')) || 12)));

  if (!isCoordinate(latitude, -90, 90) || !isCoordinate(longitude, -180, 180)) {
    return Response.json({ error: 'Invalid coordinates' }, { status: 400 });
  }

  const endpoint = new URL(`https://api.tomtom.com/traffic/services/4/flowSegmentData/relative0/${zoom}/json`);
  endpoint.searchParams.set('key', key);
  endpoint.searchParams.set('point', `${latitude},${longitude}`);
  endpoint.searchParams.set('unit', 'kmph');

  const response = await fetch(endpoint, { headers: { accept: 'application/json' } });
  if (!response.ok) return Response.json({ error: 'Traffic unavailable' }, { status: response.status });

  return new Response(response.body, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=30, s-maxage=30',
    },
  });
}
