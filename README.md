# cycleuru

Watch Bengaluru try to move in real time.

Cycleuru turns live road speeds into a moving portrait of the city. Cool blue streaks are moving freely; amber and red ones are having a very Bengaluru day.

Click a road to compare its current speed with its usual free-flow speed, or use **Find a jam** to jump between familiar bottlenecks.

## How it works

MapLibre renders the city while a small server route fetches live traffic flow from TomTom without exposing the API key. The moving streaks visualize road-flow samples, not individual vehicles.

## Run locally

Create `.env.local`:

```bash
TOMTOM_API_KEY=your_key
```

Then run:

```bash
npm install
npm run dev
```

Traffic data © TomTom. Map data © OpenStreetMap contributors.
