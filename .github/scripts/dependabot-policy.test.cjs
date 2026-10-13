'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { eligibleMetadata, verifiedDependabotCommit, approveAndMerge } = require('./dependabot-policy.cjs');
const SHA = 'a'.repeat(40);
const REPO = 'jingairpi/hello-world-action';
const metadata = type => `---\nupdated-dependencies:\n- dependency-name: "@actions/core"\n  dependency-version: 3.0.2\n  dependency-type: direct:production\n  update-type: version-update:semver-${type}\n...\n`;

function fixture() {
  const run = { id: 42, workflow_id: 7, path: '.github/workflows/test.yml', event: 'pull_request',
    status: 'completed', conclusion: 'success', run_attempt: 1,
    actor: { login: 'dependabot[bot]', id: 49699333 },
    head_repository: { full_name: REPO }, head_sha: SHA, pull_requests: [{ number: 12 }] };
  const workflow = { id: 7, path: run.path };
  const jobs = [{ name: 'run-action', conclusion: 'success' }];
  const pr = { number: 12, state: 'open', draft: false, user: { login: 'dependabot[bot]' },
    base: { ref: 'main', repo: { full_name: REPO } },
    head: { repo: { full_name: REPO }, sha: SHA, ref: 'dependabot/npm_and_yarn/actions-core-3.0.2' }, commits: 1 };
  const commit = { sha: SHA, author: { login: 'dependabot[bot]', id: 49699333 },
    committer: { login: 'web-flow', id: 19864447 },
    commit: { author: { email: '49699333+dependabot[bot]@users.noreply.github.com' },
      committer: { name: 'GitHub', email: 'noreply@github.com' },
      verification: { verified: true, reason: 'valid' }, message: metadata('patch') } };
  const context = { eventName: 'workflow_run', repo: { owner: 'jingairpi', repo: 'hello-world-action' },
    payload: { workflow_run: { id: 42, run_attempt: 1 } } };
  const mutations = [];
  const state = { run, workflow, jobs, pr, commit, context, mutations, reads: 0 };
  const github = { rest: {
    actions: { getWorkflowRun: async () => ({ data: state.run }), getWorkflow: async () => ({ data: state.workflow }),
      listJobsForWorkflowRunAttempt: () => {} },
    repos: { getCommit: async () => ({ data: state.commit }) },
    pulls: { get: async () => {
      state.reads += 1;
      return { data: state.reads > 1 && state.changedPR ? state.changedPR : state.pr };
    }, createReview: async args => { mutations.push(['review', args]); },
    merge: async args => {
      mutations.push(['merge', args]);
      if (state.mergeError) throw state.mergeError;
      return { data: { merged: state.merged ?? true } };
    } }
  }, paginate: async () => state.jobs };
  state.execute = () => approveAndMerge({ github, context, core: { info() {} } });
  return state;
}

test('recognizes genuine GitHub commit provenance independently of metadata eligibility', async () => {
  // Relevant fields projected from the GitHub REST response for
  // jingairpi/hello-world-action@f1adb17c41d0d2f208f5850a55494e3cdd4afff7.
  // This indirect security update has no update-type and must stay manual.
  const commit = {
    sha: 'f1adb17c41d0d2f208f5850a55494e3cdd4afff7',
    author: { login: 'dependabot[bot]', id: 49699333 },
    committer: { login: 'web-flow', id: 19864447 },
    commit: {
      author: { name: 'dependabot[bot]', email: '49699333+dependabot[bot]@users.noreply.github.com' },
      committer: { name: 'GitHub', email: 'noreply@github.com' },
      verification: { verified: true, reason: 'valid', verified_at: '2026-10-12T23:30:57Z' },
      message: `build(deps): bump undici from 6.27.0 to 6.29.0

Bumps [undici](https://github.com/nodejs/undici) from 6.27.0 to 6.29.0.
- [Release notes](https://github.com/nodejs/undici/releases)
- [Commits](https://github.com/nodejs/undici/compare/v6.27.0...v6.29.0)

---
updated-dependencies:
- dependency-name: undici
  dependency-version: 6.29.0
  dependency-type: indirect
...

Signed-off-by: dependabot[bot] <support@github.com>`
    }
  };
  assert.equal(verifiedDependabotCommit(commit), true);
  assert.equal(eligibleMetadata(commit.commit.message), false);
  const f = fixture();
  f.commit = commit;
  f.run.head_sha = commit.sha;
  f.pr.head.sha = commit.sha;
  assert.equal(await f.execute(), false);
  assert.deepEqual(f.mutations, []);
});

test('metadata allows all-minor/patch groups and refuses unknown or ambiguous classification', () => {
  assert.equal(eligibleMetadata(metadata('patch')), true);
  assert.equal(eligibleMetadata(metadata('minor')), true);
  assert.equal(eligibleMetadata(metadata('patch').replace('"@actions/core"', "'@actions/core'")), true);
  assert.equal(eligibleMetadata(metadata('patch').replace('"@actions/core"', 'actions/checkout')), true);
  const second = '- dependency-name: another\n  dependency-version: 2.1.0\n  dependency-type: direct:development\n  update-type: version-update:semver-minor\n';
  assert.equal(eligibleMetadata(metadata('patch').replace('...\n', `${second}...\n`)), true);
  assert.equal(eligibleMetadata(metadata('patch').replace('...\n', `${second.replace('semver-minor', 'semver-major')}...\n`)), false);
  for (const message of ['', metadata('major'), metadata('unknown'), metadata('patch') + metadata('patch'),
    metadata('patch').replace('  update-type:', '  unexpected:'),
    metadata('patch').replace('...\n', '  update-type: version-update:semver-major\n...\n'),
    metadata('patch').replace('- dependency-name:', '- unknown-name:'),
    metadata('patch').replace('  dependency-version: 3.0.2\n', ''),
    metadata('patch').replace('  dependency-type: direct:production\n', ''),
    metadata('patch').replace('"@actions/core"', '&alias'),
    metadata('patch').replace('...\n', '')]) assert.equal(eligibleMetadata(message), false, message);
});

for (const type of ['patch', 'minor']) test(`approves and atomically merges the exact tested ${type} head`, async () => {
  const f = fixture(); f.commit.commit.message = metadata(type);
  assert.equal(await f.execute(), true);
  assert.deepEqual(f.mutations.map(item => item[0]), ['review', 'merge']);
  assert.equal(f.mutations[0][1].commit_id, SHA);
  assert.equal(f.mutations[1][1].sha, SHA);
  assert.equal(f.mutations[1][1].merge_method, 'squash');
});

test('accepts the documented workflow path with its API ref suffix', async () => {
  const f = fixture(); f.run.path += '@refs/pull/12/merge';
  assert.equal(await f.execute(), true);
});

test('allows a maintainer rerun of CI originally initiated by Dependabot', async () => {
  const f = fixture();
  f.run.run_attempt = f.context.payload.workflow_run.run_attempt = 2;
  f.run.triggering_actor = { login: 'jingairpi', id: 123 };
  assert.equal(await f.execute(), true);
});

const refusals = {
  'wrong event': f => { f.context.eventName = 'pull_request'; },
  'wrong repository': f => { f.context.repo.owner = 'elsewhere'; },
  'wrong workflow ID': f => { f.run.workflow_id = 8; },
  'wrong workflow path': f => { f.workflow.path = '.github/workflows/other.yml'; },
  'wrong run path': f => { f.run.path = '.github/workflows/other.yml'; },
  'push CI': f => { f.run.event = 'push'; },
  'human-initiated CI': f => { f.run.actor = { login: 'jingairpi', id: 123 }; },
  'missing CI initiator': f => { delete f.run.actor; },
  'wrong CI initiator ID': f => { f.run.actor.id = 123; },
  'failed CI': f => { f.run.conclusion = 'failure'; },
  'unfinished CI': f => { f.run.status = 'in_progress'; },
  'stale attempt': f => { f.run.run_attempt = 2; },
  'fork CI': f => { f.run.head_repository.full_name = 'attacker/hello-world-action'; },
  'malformed SHA': f => { f.run.head_sha = 'main'; },
  'missing PR association': f => { f.run.pull_requests = []; },
  'ambiguous PR association': f => { f.run.pull_requests.push({ number: 13 }); },
  'skipped action test': f => { f.jobs[0].conclusion = 'skipped'; },
  'missing action test': f => { f.jobs = []; },
  'duplicate action tests': f => { f.jobs.push(f.jobs[0]); },
  'closed PR': f => { f.pr.state = 'closed'; },
  'draft PR': f => { f.pr.draft = true; },
  'human PR': f => { f.pr.user.login = 'jingairpi'; },
  'other target branch': f => { f.pr.base.ref = 'release'; },
  'other base repository': f => { f.pr.base.repo.full_name = 'attacker/hello-world-action'; },
  'fork PR': f => { f.pr.head.repo.full_name = 'attacker/hello-world-action'; },
  'stale CI head': f => { f.pr.head.sha = 'b'.repeat(40); },
  'non-Dependabot branch': f => { f.pr.head.ref = 'feature'; },
  'mixed commits': f => { f.pr.commits = 2; },
  'wrong commit SHA': f => { f.commit.sha = 'b'.repeat(40); },
  'human commit': f => { f.commit.author.login = 'jingairpi'; },
  'wrong author ID': f => { f.commit.author.id = 123; },
  'wrong signed email': f => { f.commit.commit.author.email = 'other@example.com'; },
  'author-preserving human-signed amendment': f => {
    f.commit.committer = { login: 'jingairpi', id: 123 };
    f.commit.commit.committer = { name: 'Human editor', email: 'human@example.com' };
    // A valid human signature, original bot author, and eligible metadata all
    // remain intact. They are insufficient to authorize an automatic merge.
  },
  'missing associated committer': f => { delete f.commit.committer; },
  'wrong committer login': f => { f.commit.committer.login = 'jingairpi'; },
  'wrong committer ID': f => { f.commit.committer.id = 123; },
  'missing raw committer': f => { delete f.commit.commit.committer; },
  'wrong raw committer name': f => { f.commit.commit.committer.name = 'Human editor'; },
  'wrong raw committer email': f => { f.commit.commit.committer.email = 'human@example.com'; },
  'unverified signature with a truthy nonboolean value': f => { f.commit.commit.verification.verified = 'true'; },
  'unverified commit': f => { f.commit.commit.verification.verified = false; },
  'invalid signature reason': f => { f.commit.commit.verification.reason = 'unsigned'; },
  'major update': f => { f.commit.commit.message = metadata('major'); },
  'changed PR during verification': f => { f.changedPR = structuredClone(f.pr); f.changedPR.head.sha = 'b'.repeat(40); }
};
for (const [name, mutate] of Object.entries(refusals)) test(`does not mutate for ${name}`, async () => {
  const f = fixture(); mutate(f);
  assert.equal(await f.execute(), false);
  assert.deepEqual(f.mutations, []);
});
for (const status of [405, 409]) test(`respects branch protection/head race (${status})`, async () => {
  const f = fixture(); f.mergeError = Object.assign(new Error('blocked'), { status });
  assert.equal(await f.execute(), false);
  assert.equal(f.mutations[1][1].sha, SHA);
});
test('unexpected API failures remain visible', async () => {
  const f = fixture(); f.mergeError = Object.assign(new Error('permission denied'), { status: 403 });
  await assert.rejects(f.execute(), /permission denied/);
});
