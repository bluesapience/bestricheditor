// Runs every tests/*.test.mjs with the Node test runner. Exits 0 if there are none.
import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const files = existsSync('tests')
  ? readdirSync('tests').filter((f) => f.endsWith('.test.mjs')).map((f) => 'tests/' + f)
  : [];
if (!files.length) {
  console.log('No tests found in tests/ — skipping.');
  process.exit(0);
}
const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(r.status ?? 1);
