import fs from 'fs';

const apiKey = process.env.TWELVEDATA_API_KEY;
if (!apiKey) {
  console.error('Missing TWELVEDATA_API_KEY');
  process.exit(1);
}

const watchlist = [
  { symbol: 'EUR/USD', bias: 'long' },
  { symbol: 'GBP/USD', bias: 'long' },
  { symbol: 'USD/JPY', bias: 'short' },
  { symbol: 'XAU/USD', bias: 'short' },
  { symbol: 'US30', bias: 'neutral' },
  { symbol: 'NAS100', bias: 'long' }
];

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.json();
}

function mapSetup(symbol, bias, price, pdh, pdl) {
  const distanceHigh = Math.abs((pdh ?? price) - price);
  const distanceLow = Math.abs(price - (pdl ?? price));
  return {
    symbol,
    price,
    previousDayHigh: pdh,
    previousDayLow: pdl,
    bias,
    contextLine: distanceHigh < distanceLow ? `Closer to PDH than PDL` : `Closer to PDL than PDH`,
    buySetup: {
      title: bias === 'short' ? 'Countertrend reclaim' : 'PDL reclaim / PDH break hold',
      entry: `Watch live structure around ${price}`,
      target: `Move toward ${pdh ?? price}`
    },
    sellSetup: {
      title: bias === 'long' ? 'Failed hold / rejection short' : 'PDH rejection / PDL break hold',
      entry: `Watch live structure around ${price}`,
      target: `Move toward ${pdl ?? price}`
    }
  };
}

async function main() {
  const markets = [];
  for (const item of watchlist) {
    const dailyUrl = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(item.symbol)}&interval=1day&outputsize=3&apikey=${apiKey}`;
    const daily = await fetchJson(dailyUrl);
    if (!daily.values || daily.values.length < 2) throw new Error(`Not enough daily data for ${item.symbol}`);
    const latestClosed = daily.values[0];
    const price = Number(latestClosed.close);
    const pdh = Number(latestClosed.high);
    const pdl = Number(latestClosed.low);
    markets.push(mapSetup(item.symbol, item.bias, price, pdh, pdl));
  }

  const payload = {
    generatedAtUtc: new Date().toISOString(),
    dataSource: 'Twelve Data',
    timezoneUsedForDailyBars: 'Provider daily bars',
    symbolsIncluded: watchlist.map(x => x.symbol),
    staleAfterMinutes: 90,
    markets
  };

  fs.writeFileSync('data/latest.json', JSON.stringify(payload, null, 2) + '\n');
  console.log(`Wrote data/latest.json with ${markets.length} markets`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
