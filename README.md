<img src="./public/favicon.svg" width="64" height="64" alt="busuru logo">

# busuru

BMTC buses, moving through Bengaluru.

Each light is one timetabled trip from a representative sample. Search for a route, stop, or time; click a bus to follow it; or press `R` to pick one at random.

## How it works

The browser loads a compact snapshot of Bengaluru's BMTC schedule, decodes the route geometry, and places each bus between its first and last scheduled stop. There is no backend and the animation is not live GPS.

The current snapshot contains 57,836 trips, 9,960 stops, and 7,355 route shapes. Source timings are community-maintained and may differ from service on the street.

## Run

```bash
npm install
cp .env.example .env.local
npm run dev
```

Add a public Mapbox token to `.env.local`. Run `python scripts/prepare_bmtc.py` to rebuild the browser files from the latest feed.

## Data

Contains information from the [community-maintained BMTC GTFS dataset](https://github.com/Vonter/bmtc-gtfs), made available under the [Open Database License](https://opendatacommons.org/licenses/odbl/1-0/).

Map © Mapbox and OpenStreetMap contributors.
