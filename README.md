# cycleuru

Watch Bengaluru try to move in real time.

Cycleuru turns live road speeds into a full-screen portrait of the city. Green roads are moving normally, yellow roads are slowing down, and red roads are having a very Bengaluru day.

Click a road to compare its current speed with its usual free-flow speed, or use **Random jam** to jump between the city's familiar bottlenecks.

## How it works

The browser renders Bengaluru with MapLibre and overlays live traffic flow from TomTom. There is no application backend and no simulated vehicle data.

## Run locally

Create `.env.local`:

```bash
NEXT_PUBLIC_TOMTOM_API_KEY=your_key
```

Then run:

```bash
npm install
npm run dev
```

Traffic data © TomTom. Map data © OpenStreetMap contributors.
