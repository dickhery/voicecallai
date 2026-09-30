import test from 'node:test';
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import { allowGenesisOrigin, GENESIS_ORIGIN } from './scripts/allow-genesis-origin.mjs';
test('Genesis origin updater preserves protected credentials, existing origins and CRLF', () => {
 const source = '# protected\r\nXAI_API_KEY="private-test-value"\r\nCORS_ALLOWED_ORIGINS="https://voicecallai.online,https://another.example"\r\nTWILIO_AUTH_TOKEN=also-private\r\n';
 const next = allowGenesisOrigin(source);
 assert.deepEqual(dotenv.parse(next), {...dotenv.parse(source), CORS_ALLOWED_ORIGINS: `https://voicecallai.online,https://another.example,${GENESIS_ORIGIN}`});
 assert.ok(next.includes('XAI_API_KEY="private-test-value"\r\n')); assert.ok(!/(?<!\r)\n/.test(next));
 assert.equal(allowGenesisOrigin(next), next);
});
test('Genesis origin updater handles absent, duplicate and export settings without wildcard widening', () => {
 for (const source of ['', 'PORT=3000', 'export CORS_ALLOWED_ORIGINS=\nCORS_ALLOWED_ORIGINS=https://voicecallai.online\n']) {
   const next = allowGenesisOrigin(source); assert.ok(dotenv.parse(next).CORS_ALLOWED_ORIGINS.includes(GENESIS_ORIGIN));
   assert.equal(allowGenesisOrigin(next), next); assert.ok(!dotenv.parse(next).CORS_ALLOWED_ORIGINS.includes('*'));
 }
 assert.equal(allowGenesisOrigin('CORS_ALLOWED_ORIGINS=*\n'), 'CORS_ALLOWED_ORIGINS=*\n');
});
