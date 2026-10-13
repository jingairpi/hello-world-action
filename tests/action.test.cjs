const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { test } = require('node:test');

const root = resolve(__dirname, '..');
const metadata = readFileSync(join(root, 'action.yml'), 'utf8');

// Model the runner's metadata default injection; the workflow also exercises
// the action without `with` to verify the real runner behavior.
const defaultInput = metadata.match(/^\s+default: (.+)$/m)?.[1];

function runAction(input = defaultInput, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'hello-action-test-'));
  try {
    const output = join(directory, 'output');
    const event = join(directory, 'event.json');
    writeFileSync(output, '');
    writeFileSync(event, options.event ?? '{}');
    const startedAt = Date.now();
    const result = spawnSync(process.execPath, [join(root, 'dist/index.js')], {
      encoding: 'utf8',
      env: {
        ...process.env,
        TZ: 'UTC',
        'INPUT_WHO-TO-GREET': input,
        GITHUB_EVENT_PATH: event,
        GITHUB_OUTPUT: options.invalidOutput ? join(directory, 'missing/output') : output
      }
    });
    const finishedAt = Date.now();
    return { ...result, startedAt, finishedAt, output: readFileSync(output, 'utf8') };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function assertGreetingTime(time, startedAt, finishedAt) {
  assert.match(time, /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d GMT\+0000 \(Coordinated Universal Time\)$/);
  const secondsInDay = 86400;
  const startSecond = Math.floor(startedAt / 1000);
  const endSecond = Math.floor(finishedAt / 1000);
  const [hours, minutes, seconds] = time.slice(0, 8).split(':').map(Number);
  let greetingSecond = Math.floor(startSecond / secondsInDay) * secondsInDay
    + hours * 3600 + minutes * 60 + seconds;
  // The output has no date. A greeting after midnight belongs to the next day.
  if (greetingSecond < startSecond) greetingSecond += secondsInDay;
  assert.ok(greetingSecond >= startSecond && greetingSecond <= endSecond,
    `Greeting time ${time} falls outside the action's execution interval`);
}

function assertSuccessfulGreeting(result, name) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout, `Hello ${name}!\n`);
  assert.equal(result.stderr, '');
  const output = result.output.match(/^time<<([^\n]+)\n([^\n]+)\n\1\n$/);
  assert.ok(output, `Expected one time output, received ${result.output}`);
  assertGreetingTime(output[2], result.startedAt, result.finishedAt);
}

test('time assertions reject stale values and handle UTC midnight rollover', () => {
  const start = Date.parse('2026-10-12T23:59:59.950Z');
  const end = Date.parse('2026-10-13T00:00:00.050Z');
  const time = (clock) => `${clock} GMT+0000 (Coordinated Universal Time)`;
  assertGreetingTime(time('23:59:59'), start, end);
  assertGreetingTime(time('00:00:00'), start, end);
  assert.throws(() => assertGreetingTime(time('12:00:00'), start, end), /execution interval/);
  assert.throws(() => assertGreetingTime(time('00:00:01'), start, end), /execution interval/);
});

test('greets the supplied name and writes a valid time output', () => {
  assertSuccessfulGreeting(runAction('Alice'), 'Alice');
});

test('metadata supplies the documented default greeting', () => {
  assert.equal(defaultInput, 'world');
  assert.match(metadata, /^\s+using: node24$/m);
  assertSuccessfulGreeting(runAction(), 'world');
});

test('trims surrounding whitespace in the input', () => {
  assertSuccessfulGreeting(runAction('  Alice  '), 'Alice');
});

test('does not depend on the GitHub event payload', () => {
  assertSuccessfulGreeting(runAction('Alice', { event: 'invalid JSON' }), 'Alice');
});

test('rejects multiline input before it can emit runner commands', () => {
  for (const input of ['Alice\n::warning::injected', 'Alice\r::error::injected']) {
    const result = runAction(input);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /::error::who-to-greet must be a single line/);
    assert.doesNotMatch(result.stdout, /injected/);
    assert.equal(result.output, '');
  }
});

test('fails the action when the output file cannot be written', () => {
  const result = runAction('Alice', { invalidOutput: true });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /::error::/);
  assert.equal(result.output, '');
});
