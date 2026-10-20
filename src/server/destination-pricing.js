// Carrier quotes run on the bridge, never through a paid IC HTTPS outcall.
// Quote the exact destination AND origin: international origin surcharges vary.
export class DestinationPricingError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DestinationPricingError';
    this.code = code;
  }
}

function positiveNumber(value, name) {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '' ||
      !Number.isFinite(Number(value)) || Number(value) <= 0) {
    throw new Error(`${name} must be a positive finite number.`);
  }
  return Number(value);
}

export function quoteRateUsd(quote, destination, origin) {
  if (!quote || quote.priceUnit !== 'USD' || quote.destinationNumber !== destination ||
      (quote.originationNumber && quote.originationNumber !== origin) ||
      !Array.isArray(quote.outboundCallPrices) || !quote.outboundCallPrices.length) return null;
  const rates = quote.outboundCallPrices.map(item => {
    const raw = item?.currentPrice;
    if ((typeof raw !== 'number' && typeof raw !== 'string') ||
        !/^\d+(?:\.\d{1,8})?$/.test(String(raw))) return NaN;
    return Number(raw);
  });
  // If Twilio returns several possible origin rates, budget the highest one.
  if (rates.some(rate => !Number.isFinite(rate) || rate < 0)) return null;
  return Math.max(...rates);
}

export function createDestinationPricingGuard({ twilioClient, maxRateUsdPerMinute = '0.03',
  fetchQuote = (destination, origin) => twilioClient.pricing.v2.voice.numbers(destination)
    .fetch({ originationNumber: origin }),
  now = Date.now, ttlMs = 6 * 60 * 60 * 1000, timeoutMs = 8000, maxEntries = 1000,
} = {}) {
  const maximum = positiveNumber(maxRateUsdPerMinute, 'MAX_OUTBOUND_RATE_USD_PER_MINUTE');
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 10_000 ||
      !Number.isFinite(ttlMs) || ttlMs < 1 || ttlMs > 6 * 60 * 60 * 1000 ||
      !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new Error('Invalid destination pricing cache limits.');
  }
  const cache = new Map();
  const pending = new Map();
  function remember(key, rate, lifetime) {
    cache.delete(key);
    cache.set(key, { rate, expiresAt: now() + lifetime });
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
  }
  function unavailable() {
    return new DestinationPricingError('DESTINATION_PRICE_UNAVAILABLE',
      'The carrier price could not be verified. No call was placed; try again later.');
  }
  async function loadRate(key, destination, origin) {
    let timer;
    try {
      const quote = await Promise.race([
        Promise.resolve().then(() => fetchQuote(destination, origin)),
        new Promise((_, reject) => { timer = setTimeout(() => reject(unavailable()), timeoutMs); }),
      ]);
      const rate = quoteRateUsd(quote, destination, origin);
      if (rate === null) throw unavailable();
      remember(key, rate, ttlMs);
      return rate;
    } catch {
      // A short negative cache prevents a long batch from hammering a failing API.
      remember(key, null, Math.min(ttlMs, 30_000));
      throw unavailable();
    } finally {
      clearTimeout(timer);
      pending.delete(key);
    }
  }
  return async function assertDestinationPrice(destination, origin) {
    if (![destination, origin].every(value => typeof value === 'string' && /^\+[1-9]\d{7,14}$/.test(value))) {
      throw unavailable();
    }
    const key = `${origin}:${destination}`;
    let entry = cache.get(key);
    let rate;
    if (entry && entry.expiresAt > now()) {
      if (entry.rate === null) throw unavailable();
      cache.delete(key);
      cache.set(key, entry);
      rate = entry.rate;
    } else {
      cache.delete(key);
      if (!pending.has(key)) {
        if (pending.size >= 8) throw unavailable();
        pending.set(key, loadRate(key, destination, origin));
      }
      rate = await pending.get(key);
    }
    if (rate > maximum) {
      throw new DestinationPricingError('DESTINATION_RATE_EXCEEDED',
        'This destination exceeds the carrier rate supported by your prepaid phone time. No call was placed.');
    }
    return { rateUsdPerMinute: rate, maximumUsdPerMinute: maximum };
  };
}
