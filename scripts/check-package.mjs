import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
if (process.env.GITHUB_REF_TYPE === 'tag') {
  assert.equal(process.env.GITHUB_REF_NAME, `v${pkg.version}`, 'Tag must match package version');
}
const staging = mkdtempSync(join(tmpdir(), 'bonko-sdk-package-'));
try {
  // Reuse the pnpm CLI that started this script; do not invoke bundled Corepack.
  assert(process.env.npm_execpath && process.env.npm_config_user_agent?.startsWith('pnpm/'),
    'Run this check with pnpm package:check');
  execFileSync(process.execPath, [process.env.npm_execpath, 'pack', '--pack-destination', staging], { stdio: 'inherit' });
  const archive = join(staging, `bonko-template-sdk-${pkg.version}.tgz`);
  const listing = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
  assert(listing.every(name => /^package\/(dist\/|package.json$|README.md$|CHANGELOG.md$|LICENSE)/.test(name)), 'Unexpected package content');
  assert(!listing.some(name => /\.test\.|node_modules|\.env/.test(name)), 'Private/test content in package');
  for (const [entry, target] of Object.entries(pkg.exports)) {
    assert(listing.includes(`package/${target.slice(2)}`), `Missing export ${entry}`);
    assert(listing.includes(`package/${target.slice(2).replace(/\.js$/, '.d.ts')}`), `Missing types ${entry}`);
    await import(pathToFileURL(join(process.cwd(), target)).href);
  }
  console.log(`Verified ${Object.keys(pkg.exports).length} exports and package contents`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
