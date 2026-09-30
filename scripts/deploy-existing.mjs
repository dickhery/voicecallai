// Upgrade only the two known production canisters. Refuse unexpected mappings.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const expected = { backend: '2dwhz-ziaaa-aaaak-qy2ia-cai', frontend: '2nukr-cyaaa-aaaak-qy2ja-cai' };
const mapping = JSON.parse(readFileSync(new URL('../.icp/data/mappings/ic.ids.json', import.meta.url), 'utf8'));
for (const [name, id] of Object.entries(expected)) if (mapping[name] !== id) throw new Error(`Unexpected production ${name} mapping`);
const identity = process.argv[2];
if (process.argv.length > 3) throw new Error('Usage: node scripts/deploy-existing.mjs [identity]');
const common = ['-e', 'ic', ...(identity ? ['--identity', identity] : [])];
function run(args) {
  const result = spawnSync('icp', [...args, ...common], { stdio: 'inherit', shell: false });
  if (result.error || result.status !== 0) throw new Error(`icp ${args[0]} failed; deployment stopped`);
}
for (const name of Object.keys(expected)) {
  const result = spawnSync('icp', ['canister', 'status', name, '--json', ...common], { encoding: 'utf8', shell: false });
  if (result.error || result.status !== 0) throw new Error(`Read-only ${name} cycle check failed; deployment stopped`);
  const status = JSON.parse(result.stdout);
  const nat = value => { if (typeof value !== 'string' || !/^\d[\d_]*$/.test(value)) throw new Error('Missing cycle/freezing value; deployment stopped'); return BigInt(value.replaceAll('_', '')); };
  if (status.id !== expected[name] || status.status !== 'Running') throw new Error(`Unexpected live ${name} identity or state`);
  const cycles = nat(status.cycles);
  const freezing = (nat(status.idle_cycles_burned_per_day) * nat(status.settings.freezing_threshold) + 86399n) / 86400n;
  // Phone seconds pay external invoices; VoiceCallAI has no cycle-denominated service allowances.
  const protectedTotal = 500000000000n + freezing + 200000000000n;
  if (cycles < protectedTotal) throw new Error(`${name} cycle buffer insufficient: ${cycles} < ${protectedTotal}`);
  console.log(`${name}: cycles ${cycles}; freezing reserve ${freezing}; protected ${protectedTotal}; surplus ${cycles - protectedTotal}`);
}
run(['canister', 'install', 'backend', '--wasm', 'src/backend/dist/backend.wasm', '--mode', 'upgrade']);
run(['sync', 'frontend']);
