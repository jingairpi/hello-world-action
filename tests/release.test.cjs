const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { test } = require('node:test');

const script = resolve(__dirname, '../.github/scripts/publish-release.sh');

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'hello-release-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const repository = join(directory, 'repository');
  const remote = join(directory, 'remote.git');
  const bin = join(directory, 'bin');
  mkdirSync(repository);
  mkdirSync(bin);
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: repository, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '--bare', remote);
  git('init');
  git('config', 'user.name', 'Release test');
  git('config', 'user.email', 'release@example.invalid');
  writeFileSync(join(repository, '.gitignore'), 'dist/\n');
  writeFileSync(join(repository, 'action.yml'), 'runs:\n  using: node24\n  main: dist/index.js\n');
  git('add', '.');
  git('commit', '-m', 'Source');
  const source = git('rev-parse', 'HEAD');
  git('remote', 'add', 'origin', remote);
  mkdirSync(join(repository, 'dist'));
  const bundle = 'console.log("tested bundle");\n';
  writeFileSync(join(repository, 'dist/index.js'), bundle);
  const mock = join(bin, 'gh');
  writeFileSync(mock, `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$GH_CALLS"
case "$1" in
  auth) exit 0 ;;
  release)
    if [ "$2" = create ] && [ "\${FAIL_CREATE:-0}" = 1 ]; then exit 1; fi
    exit 0 ;;
  api) printf '%s\\n' "\${IMMUTABLE:-true}" ;;
  *) exit 1 ;;
esac
`);
  chmodSync(mock, 0o755);
  const calls = join(directory, 'gh-calls');
  writeFileSync(calls, '');
  const publish = (overrides = {}) => spawnSync('bash', [script], {
    cwd: repository,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      GH_TOKEN: 'test-only-token',
      GH_REPO: 'test/repository',
      GH_CALLS: calls,
      VERSION: 'v1.12.0',
      SOURCE_SHA: source,
      RUNNER_TEMP: directory,
      ...overrides
    }
  });
  return { git, publish, source, bundle, repository, calls };
}

test('publishes a complete tagged tree with the exact selected source parent', (t) => {
  const f = fixture(t);
  const result = f.publish();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(f.git('rev-parse', 'v1.12.0^{}^'), f.source);
  assert.equal(f.git('show', 'v1.12.0:dist/index.js'), f.bundle.trim());
  assert.match(f.git('show', 'v1.12.0:action.yml'), /main: dist\/index.js/);
  assert.equal(f.git('ls-remote', '--heads', 'origin'), '');
  assert.match(f.git('ls-remote', '--tags', 'origin'), /refs\/tags\/v1.12.0/);
  const calls = readFileSync(f.calls, 'utf8');
  assert.match(calls, /release create v1\.12\.0 --verify-tag --draft/);
  assert.match(calls, /release edit v1\.12\.0 --draft=false/);
});

test('refuses an existing version without rewriting the remote tag', (t) => {
  const f = fixture(t);
  assert.equal(f.publish().status, 0);
  const before = f.git('ls-remote', '--tags', 'origin');
  f.git('checkout', '--detach', f.source);
  mkdirSync(join(f.repository, 'dist'), { recursive: true });
  writeFileSync(join(f.repository, 'dist/index.js'), f.bundle);
  const result = f.publish();
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /already exists/);
  assert.equal(f.git('ls-remote', '--tags', 'origin'), before);
});

test('rejects invalid version input before writing any remote refs', (t) => {
  const f = fixture(t);
  for (const version of ['v01.2.3', '1.2.3', 'v1.2', 'v1.2.3-beta', 'v1.2.3;echo injected', 'v1.2.3\ninjected']) {
    const result = f.publish({ VERSION: version });
    assert.notEqual(result.status, 0, version);
    assert.equal(f.git('ls-remote', 'origin'), '', version);
  }
  assert.equal(readFileSync(f.calls, 'utf8'), '');
});

test('refuses to publish when the checkout differs from the selected source', (t) => {
  const f = fixture(t);
  const result = f.publish({ SOURCE_SHA: '0'.repeat(40) });
  assert.notEqual(result.status, 0);
  assert.equal(f.git('ls-remote', 'origin'), '');
  assert.equal(readFileSync(f.calls, 'utf8'), '');
});

test('retains the complete tag after interrupted release creation and refuses replacement', (t) => {
  const f = fixture(t);
  const result = f.publish({ FAIL_CREATE: '1' });
  assert.notEqual(result.status, 0);
  assert.equal(f.git('show', 'v1.12.0:dist/index.js'), f.bundle.trim());
  const before = f.git('ls-remote', '--tags', 'origin');
  assert.doesNotMatch(readFileSync(f.calls, 'utf8'), /release edit/);
  f.git('checkout', '--detach', f.source);
  mkdirSync(join(f.repository, 'dist'), { recursive: true });
  writeFileSync(join(f.repository, 'dist/index.js'), f.bundle);
  assert.notEqual(f.publish().status, 0);
  assert.equal(f.git('ls-remote', '--tags', 'origin'), before);
});

test('fails qualification if GitHub does not report an immutable published release', (t) => {
  const f = fixture(t);
  assert.notEqual(f.publish({ IMMUTABLE: 'false' }).status, 0);
  assert.match(f.git('ls-remote', '--tags', 'origin'), /refs\/tags\/v1.12.0/);
  assert.match(readFileSync(f.calls, 'utf8'), /release edit/);
});
