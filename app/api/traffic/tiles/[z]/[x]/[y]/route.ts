const TILE_COORDINATE = /^\d+$/;

type RouteContext = { params: Promise<{ z: string; x: string; y: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { z, x, y } = await context.params;
  const key = process.env.TOMTOM_API_KEY ?? process.env.NEXT_PUBLIC_TOMTOM_API_KEY;

  if (!key) return new Response(null, { status: 503 });
  if (![z, x, y].every((part) => TILE_COORDINATE.test(part))) return new Response(null, { status: 400 });

  const response = await fetch(`https://api.tomtom.com/traffic/map/4/tile/flow/relative/${z}/${x}/${y}.pbf?key=${key}`);
  if (!response.ok) return new Response(null, { status: response.status });

  return new Response(response.body, {
    headers: {
      'content-type': 'application/x-protobuf',
      'cache-control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=60',
    },
  });
}
