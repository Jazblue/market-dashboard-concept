import fs from 'fs';

const apiKey = process.env.TWELVEDATA_API_KEY;
if (!apiKey) {
  console.error('Missing TWELVEDATA_API_KEY');
  process.exit(1);
}

const watchlist = [
  { symbol: 'EUR/USD', bias: 'long' },
  { symbol: 'GBP/USD', bias: 'long' },
  { symbol: 'AUD/USD', bias: 'long' },
  { symbol: 'USD/CAD', bias: 'short' }
];

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.json();
}

function mapSetup(symbol, bias, price, pdh, pdl) {
  return {
    symbol,
    price,
    previousDayHigh: pdh,
    previousDayLow: pdl,
    bias,
    contextLine: price < pdh && price > pdl ? 'Trading inside previous day range' : price >= pdh ? 'Testing or above PDH' : 'Testing or below PDL',
    buySetup: {
      title: bias === 'short' ? 'Countertrend reclaim' : 'PDL reclaim / PDH break hold',
      entry: `Watch live structure around ${price}`,
      target: `Move toward ${pdh}`
    },
    sellSetup: {
      title: bias === 'long' ? 'Failed hold / rejection short' : 'PDH rejection / PDL break hold',
      entry: `Watch live structure around ${price}`,
      target: `Move toward ${pdl}`
    }
  };
}

async function fetchMarket(item) {
  const dailyUrl = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(item.symbol)}&interval=1day&outputsize=5&apikey=${apiKey}`;
  const daily = await fetchJson(dailyUrl);
  if (!daily.values || daily.values.length < 2) {
    throw new Error(`Not enough daily data for ${item.symbol}`);
  }
  const latestClosed = daily.values[0];
  const price = Number(latestClosed.close);
  const pdh = Number(latestClosed.high);
  const pdl = Number(latestClosed.low);
  return mapSetup(item.symbol, item.bias, price, pdh, pdl);
}

async function main() {
  const markets = [];
  for (const item of watchlist) {
    try {
      const market = await fetchMarket(item);
      markets.push(market);
    } catch (err) {
      console.error(`Skipping ${item.symbol}: ${err.message}`);
    }
  }

  if (!markets.length) {
    throw new Error('No valid markets returned from Twelve Data');
  }

  const payload = {
    generatedAtUtc: new Date().toISOString(),
    dataSource: 'Twelve Data',
    timezoneUsedForDailyBars: 'Provider daily bars',
    symbolsIncluded: markets.map(x => x.symbol),
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
