import test from 'node:test';
import assert from 'node:assert/strict';
import { createDestinationPricingGuard, quoteRateUsd } from './destination-pricing.js';

const destination = '+12125550123';
const origin = '+14155550123';
const quote = (rate = '0.014') => ({ priceUnit: 'USD', destinationNumber: destination,
  originationNumber: origin, outboundCallPrices: [{ currentPrice: rate }] });

test('uses current carrier price and the highest possible origin rate', () => {
  const result = quote();
  result.outboundCallPrices.push({ currentPrice: '0.035', basePrice: '0.01' });
  assert.equal(quoteRateUsd(result, destination, origin), 0.035);
});

test('Twilio SDK lookup includes the originating number and accepts the exact ceiling', async () => {
  let requested;
  const guard = createDestinationPricingGuard({ twilioClient: {
    pricing: { v2: { voice: { numbers: to => ({ fetch: async options => {
      requested = { to, ...options };
      return quote('0.03000000');
    } }) } } },
  } });
  await guard(destination, origin);
  assert.deepEqual(requested, { to: destination, originationNumber: origin });
});

test('rejects missing, wrong-currency, wrong-destination and malformed quotes', () => {
  for (const value of [null, { ...quote(), priceUnit: 'EUR' },
    { ...quote(), destinationNumber: origin }, { ...quote(), originationNumber: destination },
    { ...quote(), outboundCallPrices: [] }, quote(null), quote(''), quote('-0.01'), quote('NaN')]) {
    assert.equal(quoteRateUsd(value, destination, origin), null);
  }
});

test('checks destination+origin, reuses a bounded quote, and refreshes after expiry', async () => {
  let time = 0;
  const requests = [];
  const guard = createDestinationPricingGuard({ now: () => time, ttlMs: 100,
    fetchQuote: async (to, from) => { requests.push([to, from]); return { ...quote(), destinationNumber: to, originationNumber: from }; } });
  assert.equal((await guard(destination, origin)).rateUsdPerMinute, 0.014);
  await guard(destination, origin);
  assert.equal(requests.length, 1);
  await guard(destination, '+14155550124');
  assert.equal(requests.length, 2);
  time = 101;
  await guard(destination, origin);
  assert.equal(requests.length, 3);
  assert.deepEqual(requests[0], [destination, origin]);
});

test('refuses expensive calls and fails closed when carrier lookup fails', async () => {
  const expensive = createDestinationPricingGuard({ fetchQuote: async () => quote('0.0945') });
  await assert.rejects(expensive(destination, origin), { code: 'DESTINATION_RATE_EXCEEDED' });
  const unavailable = createDestinationPricingGuard({ fetchQuote: async () => { throw new Error('provider private error'); } });
  await assert.rejects(unavailable(destination, origin), error => error.code === 'DESTINATION_PRICE_UNAVAILABLE' && !error.message.includes('private'));
});

test('coalesces simultaneous lookups and caps cache entries', async () => {
  let count = 0;
  const guard = createDestinationPricingGuard({ maxEntries: 1, fetchQuote: async to => {
    count++;
    return { ...quote(), destinationNumber: to };
  } });
  await Promise.all([guard(destination, origin), guard(destination, origin)]);
  assert.equal(count, 1);
  await guard('+12125550124', origin);
  await guard(destination, origin);
  assert.equal(count, 3);
});

test('timeouts fail closed and repeated provider failures are briefly cached', async () => {
  let count = 0;
  const guard = createDestinationPricingGuard({ timeoutMs: 5, fetchQuote: async () => {
    count++;
    return new Promise(() => {});
  } });
  await assert.rejects(guard(destination, origin), { code: 'DESTINATION_PRICE_UNAVAILABLE' });
  await assert.rejects(guard(destination, origin), { code: 'DESTINATION_PRICE_UNAVAILABLE' });
  assert.equal(count, 1);
});

test('invalid operator configuration and invalid numbers cannot bypass the limit', async () => {
  for (const value of ['', '0', '-1', 'Infinity', 'NaN']) {
    assert.throws(() => createDestinationPricingGuard({ maxRateUsdPerMinute: value }));
  }
  let called = false;
  const guard = createDestinationPricingGuard({ fetchQuote: async () => { called = true; return quote(); } });
  await assert.rejects(guard('12125550123', origin), { code: 'DESTINATION_PRICE_UNAVAILABLE' });
  assert.equal(called, false);
});
