import { beforeEach, expect, test, vi } from 'vitest';
import { createHash } from 'node:crypto';
const mocks = vi.hoisted(() => ({ readFileSync: vi.fn(), execFileSync: vi.fn(), spawnSync: vi.fn() }));
vi.mock('node:fs', () => ({ readFileSync: mocks.readFileSync }));
vi.mock('node:child_process', () => ({ execFileSync: mocks.execFileSync, spawnSync: mocks.spawnSync }));
const bytes = Buffer.from('verified archive');
const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
let version;
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  version = '0.2.2';
  mocks.readFileSync.mockImplementation(path => path === 'package.json'
    ? JSON.stringify({ name: '@bonko/template-sdk', version, publishConfig: { access: 'public', registry: 'https://registry.npmjs.org/' } }) : bytes);
  mocks.spawnSync.mockReturnValue({ status: 1, stdout: JSON.stringify({ error: { code: 'E404' } }) });
});
test('publishes only the verified archive using the appropriate dist-tag', async () => {
  await import('./publish-npm.mjs');
  expect(mocks.execFileSync).toHaveBeenCalledWith('npm', ['publish', './artifacts/bonko-template-sdk-0.2.2.tgz', '--access', 'public', '--tag', 'latest', '--registry=https://registry.npmjs.org/'], { stdio: 'inherit' });
});
test('prereleases use next', async () => {
  version = '0.3.0-rc.1';
  await import('./publish-npm.mjs');
  expect(mocks.execFileSync.mock.calls[0][1]).toContain('next');
});
test('an identical published archive can resume the release without republishing', async () => {
  mocks.spawnSync.mockReturnValue({ status: 0, stdout: JSON.stringify(integrity) });
  await import('./publish-npm.mjs');
  expect(mocks.execFileSync).not.toHaveBeenCalled();
});
test('different published bytes cannot be overwritten', async () => {
  mocks.spawnSync.mockReturnValue({ status: 0, stdout: JSON.stringify('sha512-other') });
  await expect(import('./publish-npm.mjs')).rejects.toThrow('different bytes');
  expect(mocks.execFileSync).not.toHaveBeenCalled();
});
test('registry authorization and network errors do not trigger publication', async () => {
  mocks.spawnSync.mockReturnValue({ status: 1, stdout: JSON.stringify({ error: { code: 'E403' } }) });
  await expect(import('./publish-npm.mjs')).rejects.toThrow('Could not confirm');
  expect(mocks.execFileSync).not.toHaveBeenCalled();
});
