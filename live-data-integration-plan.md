# Live-data integration plan for the PDH / PDL Trade Map

## Goal
Upgrade the current static concept into a **GitHub Pages-friendly dashboard** that refreshes market data **hourly** while keeping the site itself static, cheap, and low-risk.

## Recommended implementation shape
Use a **hybrid static architecture**:

- **Static frontend** stays in `index.html` + small JS/CSS
- **Hourly data update script** runs in **GitHub Actions**
- The script fetches a small watchlist from one free API provider, computes derived fields, and writes a versioned JSON file such as `data/latest.json`
- GitHub Pages serves the static page and latest JSON
- Client-side JS renders the dashboard from that JSON

That is the cleanest shape because:
- GitHub Pages cannot run server code
- hourly updates do not require a full app backend
- API keys stay in GitHub Actions secrets, not in browser code
- the public site remains fast and cacheable

## What data the dashboard needs
For each instrument, store only the fields the page actually uses.

### Core market fields per symbol
- `symbol` - e.g. `EUR/USD`, `GBP/USD`, `XAU/USD`, `NAS100`, `US30`
- `providerSymbol` - the raw symbol used by the API
- `assetClass` - `forex`, `metal`, `index`, etc.
- `price` - latest tradable/quote price
- `timestampUtc` - latest quote timestamp
- `dayChangePct` - optional if the provider gives it; otherwise compute from prior close

### Previous-day range fields
- `previousDayHigh`
- `previousDayLow`
- `previousDayOpen` - optional but useful for context
- `previousDayClose` - useful for change % and bias copy
- `previousDayDate`

### Derived fields to compute in the update script
- `distanceToPdh`
- `distanceToPdl`
- `distanceToMid`
- `insidePreviousDayRange` - boolean
- `abovePdh` / `belowPdl` - booleans
- `rangePositionPct` - where current price sits between PDL and PDH
- `bias` - `long`, `short`, `neutral`
- `contextLine` - short UI copy such as `12 pips under PDH`

### Page-level metadata
- `generatedAtUtc`
- `dataSource`
- `timezoneUsedForDailyBars`
- `symbolsIncluded`
- `staleAfterMinutes` - e.g. `90`

## How to compute previous-day high/low correctly
This is the key part.

Use **daily bars**, not rolling 24-hour highs/lows.

### Rule
For each symbol:
1. Fetch the latest quote
2. Fetch at least the last **2 completed daily candles**
3. Use the **most recent fully completed daily candle** as the previous day
4. Set:
   - `previousDayHigh = dailyBar[prev].high`
   - `previousDayLow = dailyBar[prev].low`
   - `previousDayClose = dailyBar[prev].close`

### Why this matters
- rolling 24h data will drift during the day and break the PDH/PDL logic
- previous day must be a **closed session/day bar**
- the script should ignore any still-forming daily candle if the provider exposes one

### Timezone guidance
Pick one explicit convention and keep it consistent in the JSON and UI:
- simplest: use the provider's daily candle boundary as-is
- if the strategy is London-session-focused, document that the dashboard uses the provider's daily bars and not a custom broker reset

For a first version, that is safer than trying to rebuild custom session candles yourself.

## Free API constraint strategy
Do **not** try to support a huge watchlist on free tiers.

### Best practical shape
Start with a small watchlist, for example:
- EUR/USD
- GBP/USD
- USD/JPY
- XAU/USD
- NAS100
- US30

### Provider recommendation
Use **one provider only** if possible, so the script stays simple.

A provider like **Twelve Data** is the most practical fit for this shape because its free tier is built around limited daily credits and can still support a small hourly-updated watchlist if requests are kept tight. By contrast, Alpha Vantage free usage is much tighter for this use case.

### Budget the requests
For hourly updates on 6 symbols:
- latest quote request(s)
- daily bar request(s)
- ideally use **batch endpoints** where supported
- target roughly **8-12 runs per trading day**, not every 24/7 hour if limits are tight

### Good constraint rules
- only refresh during market-relevant hours if credits are limited
- skip weekend updates
- cache and reuse unchanged symbol metadata
- fail soft if one symbol errors; do not block the whole page

## What should run client-side vs update script

### Put in the hourly update script
Anything that depends on API keys, rate limits, or cross-symbol ranking:
- fetching quotes
- fetching daily candles
- computing previous day high/low
- computing distances and range position
- scoring/ranking top buy and sell setups
- producing short context strings
- writing `data/latest.json`
- optionally writing `data/history/YYYY-MM-DD-HH.json` for debugging/archive

### Put client-side in the browser
Only lightweight rendering logic:
- fetch `data/latest.json`
- render cards, table rows, and ranked setup sections
- show `generatedAtUtc`
- show stale-data warning if JSON is older than threshold
- optionally auto-refresh the JSON in-browser every 5-10 minutes

### Avoid client-side API calls
Do not call the market API directly from the browser because:
- the API key would be exposed
- browser CORS may fail
- every visitor would consume API quota
- the site would become unreliable under free-tier limits

## Ranking logic for the setup lists
Keep V1 deterministic and simple.

### Suggested scoring inputs
For each symbol, compute two candidate scores:
- `longScore`
- `shortScore`

Inputs can include:
- distance to PDH/PDL
- whether price is inside range or already beyond an extreme
- whether current price is closer to a continuation setup or rejection setup
- available room to the opposite side of the range

### Example simple rules
- If price is just above PDL and back inside range -> higher long score
- If price is just below PDH and rejecting -> higher short score
- If price is mid-range -> neutral / low score
- If price has already extended far beyond a level -> reduce score

Keep the ranking rules in the script, not in the page.

## File layout
A clean repo shape:

```text
market-dashboard-concept/
  index.html
  assets/
    app.js
    styles.css
  data/
    latest.json
  scripts/
    update-market-data.mjs
  .github/
    workflows/
      update-market-data.yml
  README.md
```

## Hourly refresh workflow
Use a scheduled GitHub Actions workflow.

### Workflow shape
1. Trigger on schedule, e.g. hourly
2. Checkout repo
3. Set up Node
4. Run `node scripts/update-market-data.mjs`
5. Commit changed `data/latest.json`
6. Push to the publishing branch

### Important note on GitHub scheduling
GitHub Actions schedules are not guaranteed to run at the exact minute, so design for **rough hourly freshness**, not exact real-time behavior.

### Safe schedule example
- hourly on weekdays
- optionally a narrower schedule during London + New York overlap if conserving credits matters

## Safest publish/update path for GitHub Pages
The safest path is:

### Option A - recommended
- Keep site source and generated JSON in the same repo
- GitHub Pages publishes from the main branch or `docs/`
- The scheduled workflow updates **only the JSON data files**
- The workflow commits only when content changed

Why this is safest:
- no separate deployment target needed
- no custom server
- no force-push publishing step
- rollback is easy from normal git history

### Safety guards to add
- write JSON to a temp file first, validate it, then replace `data/latest.json`
- if API fetch fails completely, keep the last good JSON and exit non-destructively
- add schema validation before commit
- add a `status` field such as `ok`, `partial`, `stale`
- never overwrite good data with empty arrays or null-heavy output

### Safer than rebuilding HTML each hour
Do **not** regenerate the whole `index.html` on each update unless needed. Keep HTML stable and only update JSON. That sharply lowers the chance of publishing a broken site.

## Failure handling
The page should degrade gracefully.

### Script-side
- if one symbol fails, keep last known data for that symbol and mark it stale
- if all symbols fail, do not commit a new file
- log provider errors clearly in the Action output

### Client-side
- show `Last updated: ...`
- show `Data delayed` if `generatedAtUtc` is too old
- preserve layout even if one symbol is unavailable
- fall back to `N/A` rather than hiding sections abruptly

## Minimal JSON shape
```json
{
  "generatedAtUtc": "2026-04-23T18:00:00Z",
  "status": "ok",
  "dataSource": "Twelve Data",
  "timezoneUsedForDailyBars": "provider_daily_bar",
  "markets": [
    {
      "symbol": "EUR/USD",
      "providerSymbol": "EUR/USD",
      "assetClass": "forex",
      "price": 1.0874,
      "timestampUtc": "2026-04-23T18:00:00Z",
      "previousDayHigh": 1.0886,
      "previousDayLow": 1.0818,
      "previousDayClose": 1.0854,
      "distanceToPdh": -0.0012,
      "distanceToPdl": 0.0056,
      "insidePreviousDayRange": true,
      "rangePositionPct": 82.4,
      "bias": "long",
      "contextLine": "12 pips under PDH after higher low"
    }
  ],
  "rankings": {
    "buy": ["GBP/USD", "EUR/USD", "NAS100"],
    "sell": ["XAU/USD", "USD/JPY", "US30"]
  }
}
```

## Recommended implementation sequence
1. Move current inline CSS/JS into `assets/`
2. Replace hard-coded market values in `index.html` with empty render targets
3. Add `data/latest.json` with seed demo data
4. Add `assets/app.js` to fetch and render the JSON
5. Add `scripts/update-market-data.mjs`
6. Add GitHub Actions scheduled workflow
7. Add stale-data banner and last-updated label
8. Test locally with a saved JSON fixture before turning on the scheduler

## V1 recommendation
For the cleanest first live version:
- static page on GitHub Pages
- one scheduled GitHub Action every hour
- one small watchlist
- one provider
- update JSON only
- client renders from JSON
- compute PDH/PDL from completed daily bars in the script

That gives you a live-feeling dashboard without turning the project into a backend app.

## Biggest risks to avoid
- exposing API keys in frontend code
- using rolling 24h highs/lows instead of prior closed daily bars
- supporting too many symbols on a free tier
- publishing a broken page because HTML is regenerated on each run
- assuming GitHub Actions cron is real-time

## Bottom-line recommendation
Keep the site static, keep the logic in one hourly Node update script, publish only JSON updates through GitHub Actions, and treat PDH/PDL as derived from the most recent fully closed daily candle. That is the simplest, safest, and most GitHub-Pages-friendly way to make this concept feel live under free API limits.
