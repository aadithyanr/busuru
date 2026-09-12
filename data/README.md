# Data

Busuru uses the unofficial, community-maintained [BMTC GTFS feed](https://github.com/Vonter/bmtc-gtfs).

The 7 September 2026 snapshot contains:

- 57,836 scheduled trips
- 9,960 stops
- 7,355 route shapes
- 2,492,304 raw shape points

`python scripts/prepare_bmtc.py` downloads the latest feed and writes compact browser-ready files to `public/data/bmtc`. It simplifies route geometry, encodes shapes as polylines, groups trips into route patterns, and builds the route and stop search index.

Positions are interpolated between each trip's scheduled start and end. They are not live GPS positions, and source timings may be inaccurate.

Contains information from the BMTC dataset made available under the [Open Database License](https://opendatacommons.org/licenses/odbl/1-0/).
