#!/usr/bin/env python3

import argparse
import csv
import json
import math
import tempfile
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path


SOURCE = "https://raw.githubusercontent.com/Vonter/bmtc-gtfs/main/gtfs/bmtc.zip"
ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "public" / "data" / "bmtc"


def parse_args():
    parser = argparse.ArgumentParser(description="Prepare compact BMTC schedule data for Busuru.")
    parser.add_argument("--source", type=Path, help="Use a local GTFS zip instead of downloading the latest feed.")
    return parser.parse_args()


def parse_time(value: str) -> int:
    if not value:
        return 0
    hours, minutes, seconds = (int(part) for part in value.split(":"))
    return hours * 3600 + minutes * 60 + seconds


def point_segment_distance_sq(point, start, end):
    x, y = point
    x1, y1 = start
    x2, y2 = end
    dx = x2 - x1
    dy = y2 - y1
    if dx == 0 and dy == 0:
        return (x - x1) ** 2 + (y - y1) ** 2
    ratio = max(0, min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
    nearest_x = x1 + ratio * dx
    nearest_y = y1 + ratio * dy
    return (x - nearest_x) ** 2 + (y - nearest_y) ** 2


def simplify(points, tolerance=0.000055):
    if len(points) <= 2:
        return points
    keep = {0, len(points) - 1}
    stack = [(0, len(points) - 1)]
    threshold = tolerance * tolerance
    while stack:
        first, last = stack.pop()
        furthest = 0
        furthest_index = 0
        for index in range(first + 1, last):
            distance = point_segment_distance_sq(points[index], points[first], points[last])
            if distance > furthest:
                furthest = distance
                furthest_index = index
        if furthest > threshold:
            keep.add(furthest_index)
            stack.append((first, furthest_index))
            stack.append((furthest_index, last))
    return [points[index] for index in sorted(keep)]


def encode_polyline(points, precision=5):
    factor = 10 ** precision
    previous_latitude = 0
    previous_longitude = 0
    encoded = []

    def encode_value(value):
        shifted = ~(value << 1) if value < 0 else value << 1
        while shifted >= 0x20:
            encoded.append(chr((0x20 | (shifted & 0x1F)) + 63))
            shifted >>= 5
        encoded.append(chr(shifted + 63))

    for longitude, latitude in points:
        latitude_value = round(latitude * factor)
        longitude_value = round(longitude * factor)
        encode_value(latitude_value - previous_latitude)
        encode_value(longitude_value - previous_longitude)
        previous_latitude = latitude_value
        previous_longitude = longitude_value
    return "".join(encoded)


def write_json(path: Path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def load_routes(feed: Path):
    routes = {}
    route_rows = 0
    with (feed / "routes.txt").open(newline="", encoding="utf-8-sig") as source:
        for row in csv.DictReader(source):
            route_rows += 1
            routes.setdefault(row["route_id"], {
                "short": row["route_short_name"],
                "long": row["route_long_name"],
            })
    return routes, route_rows


def load_stops(feed: Path):
    stops = {}
    with (feed / "stops.txt").open(newline="", encoding="utf-8-sig") as source:
        for row in csv.DictReader(source):
            stops[row["stop_id"]] = {
                "name": row["stop_name"],
                "description": row["stop_desc"],
                "coordinate": [round(float(row["stop_lon"]), 5), round(float(row["stop_lat"]), 5)],
            }
    return stops


def load_shapes(feed: Path):
    shape_ids = []
    encoded_shapes = []
    shape_index = {}
    current_id = None
    current_points = []
    raw_points = 0
    simplified_points = 0

    def finish_shape():
        nonlocal simplified_points
        if current_id is None or len(current_points) < 2:
            return
        clean = simplify(current_points)
        shape_index[current_id] = len(shape_ids)
        shape_ids.append(current_id)
        encoded_shapes.append(encode_polyline(clean))
        simplified_points += len(clean)

    with (feed / "shapes.txt").open(newline="", encoding="utf-8-sig") as source:
        for row in csv.DictReader(source):
            shape_id = row["shape_id"]
            if current_id is not None and shape_id != current_id:
                finish_shape()
                current_points = []
            current_id = shape_id
            current_points.append([float(row["shape_pt_lon"]), float(row["shape_pt_lat"])])
            raw_points += 1
    finish_shape()
    return shape_ids, encoded_shapes, shape_index, raw_points, simplified_points


def load_trips(feed: Path):
    trips = {}
    with (feed / "trips.txt").open(newline="", encoding="utf-8-sig") as source:
        for row in csv.DictReader(source):
            trips[row["trip_id"]] = {
                "route": row["route_id"],
                "shape": row["shape_id"],
                "headsign": row["trip_headsign"],
                "direction": int(row["direction_id"] or 0),
            }
    return trips


def build_schedule(feed: Path, trips, routes, stops, shape_index):
    patterns = []
    pattern_index = {}
    schedule = []
    stop_patterns = defaultdict(set)

    current_trip = None
    current_rows = []

    def finish_trip():
        if current_trip is None or current_trip not in trips or not current_rows:
            return
        metadata = trips[current_trip]
        if metadata["shape"] not in shape_index:
            return
        first = current_rows[0]
        last = current_rows[-1]
        start = parse_time(first["departure_time"] or first["arrival_time"])
        end = parse_time(last["arrival_time"] or last["departure_time"])
        if end <= start:
            return

        key = (metadata["route"], metadata["shape"], metadata["headsign"], first["stop_id"], last["stop_id"])
        if key not in pattern_index:
            route = routes.get(metadata["route"], {"short": metadata["route"], "long": metadata["headsign"]})
            origin = stops.get(first["stop_id"], {"name": "Unknown stop"})["name"]
            destination = stops.get(last["stop_id"], {"name": metadata["headsign"]})["name"]
            pattern_index[key] = len(patterns)
            patterns.append([
                metadata["route"],
                route["short"],
                route["long"],
                metadata["headsign"],
                origin,
                destination,
                shape_index[metadata["shape"]],
                metadata["direction"],
            ])
        pattern = pattern_index[key]
        schedule.append([pattern, start, end])
        if end > 86_400:
            schedule.append([pattern, start - 86_400, end - 86_400])
        for row in current_rows:
            stop_patterns[row["stop_id"]].add(pattern)

    with (feed / "stop_times.txt").open(newline="", encoding="utf-8-sig") as source:
        for row in csv.DictReader(source):
            trip_id = row["trip_id"]
            if current_trip is not None and trip_id != current_trip:
                finish_trip()
                current_rows = []
            current_trip = trip_id
            current_rows.append(row)
    finish_trip()

    schedule.sort(key=lambda trip: trip[1])
    stop_search = []
    for stop_id, pattern_ids in stop_patterns.items():
        stop = stops.get(stop_id)
        if not stop:
            continue
        stop_search.append([
            stop_id,
            stop["name"],
            stop["description"],
            stop["coordinate"][0],
            stop["coordinate"][1],
            sorted(pattern_ids),
        ])
    stop_search.sort(key=lambda stop: stop[1])
    return patterns, schedule, stop_search


def peak_active(schedule):
    events = []
    for _, start, end in schedule:
        clipped_start = max(0, start)
        clipped_end = min(86_400, end)
        if clipped_end > clipped_start:
            events.append((clipped_start, 1))
            events.append((clipped_end, -1))
    active = 0
    peak = 0
    peak_at = 0
    for moment, change in sorted(events, key=lambda event: (event[0], event[1])):
        active += change
        if active > peak:
            peak = active
            peak_at = moment
    return peak, peak_at


def prepare(zip_path: Path):
    with tempfile.TemporaryDirectory(prefix="busuru-bmtc-feed-") as temporary:
        feed = Path(temporary)
        with zipfile.ZipFile(zip_path) as archive:
            archive.extractall(feed)

        routes, route_rows = load_routes(feed)
        stops = load_stops(feed)
        shape_ids, shapes, shape_index, raw_points, simplified_points = load_shapes(feed)
        trips = load_trips(feed)
        patterns, schedule, stop_search = build_schedule(feed, trips, routes, stops, shape_index)

        with (feed / "calendar.txt").open(newline="", encoding="utf-8-sig") as source:
            calendar = next(csv.DictReader(source))
        with (feed / "feed_info.txt").open(newline="", encoding="utf-8-sig") as source:
            feed_info = next(csv.DictReader(source))

    peak, peak_at = peak_active(schedule)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    write_json(OUTPUT_DIR / "shapes.json", shapes)
    write_json(OUTPUT_DIR / "patterns.json", patterns)
    write_json(OUTPUT_DIR / "trips.json", schedule)
    write_json(OUTPUT_DIR / "stops.json", stop_search)
    write_json(OUTPUT_DIR / "index.json", {
        "routeRows": route_rows,
        "uniqueRoutes": len(routes),
        "scheduledTrips": len(trips),
        "stops": len(stops),
        "patterns": len(patterns),
        "shapes": len(shape_ids),
        "rawShapePoints": raw_points,
        "simplifiedShapePoints": simplified_points,
        "peakActive": peak,
        "peakAt": peak_at,
        "feedStart": calendar["start_date"],
        "feedEnd": calendar["end_date"],
        "feedVersion": feed_info.get("feed_version", ""),
        "source": SOURCE,
    })
    total_size = sum(path.stat().st_size for path in OUTPUT_DIR.glob("*.json"))
    print(
        f"Prepared {len(trips):,} scheduled trips, {route_rows:,} route definitions, "
        f"{len(stops):,} stops, and {len(patterns):,} patterns ({total_size / 1_000_000:.1f} MB)."
    )


def main():
    args = parse_args()
    if args.source:
        prepare(args.source.resolve())
        return
    with tempfile.TemporaryDirectory(prefix="busuru-bmtc-download-") as temporary:
        archive = Path(temporary) / "bmtc.zip"
        urllib.request.urlretrieve(SOURCE, archive)
        prepare(archive)


if __name__ == "__main__":
    main()
