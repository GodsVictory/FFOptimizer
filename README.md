# FF Optimizer

A fast, lightweight Fantasy Football starting lineup optimizer that matches team rosters against FantasyPros consensus weekly rankings to calculate optimal starting lineups and identify start/sit opportunities.

Supports **Sleeper**, **ESPN**, and **Yahoo Fantasy**.

---

## Features

- **Multi-Platform Support**:
  - **Sleeper**: Connects via Sleeper League ID (public API).
  - **ESPN**: Connects via ESPN League ID (public leagues).
  - **Yahoo Fantasy**:
    - **Quick Roster Import (Recommended & Zero-Auth)**: Works with 100% of Yahoo leagues (public or private). Copy your roster table from your Yahoo team page and paste directly into FF Optimizer.
    - **Yahoo REST API**: Connect using League ID and optional OAuth Access Token or CORS proxy.
- **Lineup Optimization Engine**:
  - Deterministically assigns optimal starters for fixed slots (QB, RB, WR, TE, K, DST) and Flex slots (RB/WR/TE or RB/WR).
  - **Start Alerts**: Highlights bench players who should be started (highlighted in blue with `START` badge).
  - **Bench Alerts**: Flags current starters who are projected to underperform and should be benched (highlighted in red with `BENCH` badge).
- **High Performance**:
  - **$O(1)$ Player Matching**: Normalizes player names, suffixes, and defense aliases to match players in <1ms without freezing the UI.
  - **Parallel Requests**: Fetches all position consensus rankings in parallel using `Promise.all()`.
  - **In-Memory Caching**: Seamlessly switch between scoring systems (Standard, Half PPR, PPR) and Flex rules with zero repeated network requests.
  - **Batch Sleeper Endpoint**: Fetches all league users in one bulk request instead of 10-14 sequential calls.
- **Modern Modular Architecture**:
  - Clean separation into dedicated services (`fantasyProsService`, `sleeperService`, `espnService`, `yahooService`, `optimizerService`), configuration constants, and external stylesheet.

---

## Directory Structure

```
.
├── css/
│   └── app.css                 # Extracted styles, starter/bench highlights, loading overlay
├── data/                       # Cached weekly rankings and player metadata
│   ├── HALF-*.json             # Half PPR rankings
│   ├── PPR-*.json              # Full PPR rankings
│   ├── STD-*.json              # Standard scoring rankings
│   ├── lastUpdatedAt.json      # Metadata timestamp and active NFL week
│   └── sleeperPlayers.json     # Sleeper player database mapping
├── js/
│   ├── config.js               # Position maps, slot definitions, canonical defense dictionary
│   ├── playerMatcher.js        # O(1) normalized player matching and fuzzy fallback
│   ├── services/
│   │   ├── fantasyProsService.js # Parallel rankings loader and cache
│   │   ├── sleeperService.js   # Sleeper API integration
│   │   ├── espnService.js      # ESPN API integration
│   │   ├── yahooService.js     # Yahoo roster text parser & API client
│   │   └── optimizerService.js # Core lineup solver and bench alerts
│   └── app.js                  # Main Vue 2 application controller
├── tests/
│   ├── test_optimizer.js       # Unit tests for matcher, Yahoo parser, and optimizer
│   ├── test_real_data.js       # End-to-end integration test against repository data
│   └── serve_check.js          # HTTP static asset validation
├── getFPData.py                # Python scraper to update weekly FantasyPros consensus ranks
├── index.html                  # Main web application entry point
└── README.md
```

---

## Quick Start

### Running the Web App

You can serve the app using any static HTTP server or open directly via GitHub Pages:

```bash
# Using Node.js
npx serve .

# Or using Python
python -m http.server 8080
```

Open `http://localhost:8080` in your browser.

---

## Updating Weekly Rankings

To fetch the latest consensus rankings and NFL week data from FantasyPros:

```bash
python getFPData.py
```

This updates all `data/*.json` files for the active NFL week (weeks 1–18).

---

## Running Tests

Run the unit and integration tests using Node.js:

```bash
# Run unit tests
node tests/test_optimizer.js

# Run real data integration test
node tests/test_real_data.js

# Run HTTP server asset check
node tests/serve_check.js
```
