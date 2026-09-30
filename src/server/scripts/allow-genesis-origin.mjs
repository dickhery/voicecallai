import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
export const GENESIS_ORIGIN = 'https://o5wsa-gaaaa-aaaaa-qhq3a-cai.icp0.io';
export function allowGenesisOrigin(source) {
  const configured = dotenv.parse(source).CORS_ALLOWED_ORIGINS ?? '';
  const origins = configured.split(',').map(s => s.trim()).filter(Boolean);
  if (origins.includes(GENESIS_ORIGIN) || origins.includes('*')) return source;
  origins.push(GENESIS_ORIGIN);
  const line = `CORS_ALLOWED_ORIGINS=${origins.join(',')}`;
  const existing = /^(?:export\s+)?CORS_ALLOWED_ORIGINS\s*=.*$/gm;
  if (existing.test(source)) return source.replace(existing, line);
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  return source + (source.endsWith('\n') ? '' : newline) + line + newline;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2] || process.argv.length !== 3) throw new Error('Provide the existing protected voice .env path');
  const source = readFileSync(process.argv[2], 'utf8');
  const next = allowGenesisOrigin(source);
  // Write in place to preserve the existing protected file ACL. Never log credentials.
  if (source !== next) writeFileSync(process.argv[2], next);
  console.log('Genesis browser origin configured; existing provider credentials preserved.');
}
