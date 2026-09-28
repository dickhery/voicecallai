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
for (const name of Object.keys(expected)) run(['canister', 'status', name]);
run(['canister', 'install', 'backend', '--wasm', 'src/backend/dist/backend.wasm', '--mode', 'upgrade']);
run(['sync', 'frontend']);
