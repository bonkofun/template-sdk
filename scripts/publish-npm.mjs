import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
assert.equal(pkg.publishConfig?.access, 'public');
assert.equal(pkg.publishConfig?.registry, 'https://registry.npmjs.org/');
assert(!pkg.private, 'Private packages cannot be published');
const archive = `./artifacts/${pkg.name.replace(/^@/, '').replace('/', '-')}-${pkg.version}.tgz`;
const integrity = `sha512-${createHash('sha512').update(readFileSync(archive)).digest('base64')}`;
const registry = '--registry=https://registry.npmjs.org/';
const result = spawnSync('npm', ['view', `${pkg.name}@${pkg.version}`, 'dist.integrity', '--json', registry], { encoding: 'utf8' });
if (result.error) throw result.error;
const response = JSON.parse(result.stdout || 'null');
if (result.status === 0 && typeof response === 'string') {
  assert.equal(response, integrity, 'Published version has different bytes; increment the version instead of overwriting it');
  console.log(`${pkg.name}@${pkg.version} already contains the verified archive; continuing release.`);
} else {
  assert(result.status !== 0 && response?.error?.code === 'E404',
    'Could not confirm that this npm version is unpublished; check registry connectivity and access');
  const tag = pkg.version.includes('-') ? 'next' : 'latest';
  execFileSync('npm', ['publish', archive, '--access', 'public', '--tag', tag, registry], { stdio: 'inherit' });
}
