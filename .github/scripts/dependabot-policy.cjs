'use strict';

const REPOSITORY = 'jingairpi/hello-world-action';
const WORKFLOW = '.github/workflows/test.yml';
const BOT = 'dependabot[bot]';
const TYPES = new Set(['version-update:semver-patch', 'version-update:semver-minor']);

// A signed author field does not identify the signer: a human can amend a bot
// commit while retaining its author. GitHub's REST `valid` signature result
// checks the signing identity against the committer email. Require the exact
// GitHub committer identity as well as the Dependabot author identity.
// This relies on GitHub's verification record, not an independent attestation
// of the actor that initiated the commit or a private Dependabot signing key.
function verifiedDependabotCommit(commit) {
  return commit?.author?.login === BOT && commit.author.id === 49699333 &&
    commit.commit?.author?.email === '49699333+dependabot[bot]@users.noreply.github.com' &&
    commit.committer?.login === 'web-flow' && commit.committer.id === 19864447 &&
    commit.commit.committer?.email === 'noreply@github.com' &&
    commit.commit.verification?.verified === true && commit.commit.verification.reason === 'valid';
}

function scalar(value) {
  try {
    if (value.startsWith('"')) value = JSON.parse(value);
    else if (/^'[^']*'$/.test(value)) value = value.slice(1, -1);
    return typeof value === 'string' && /^[A-Za-z0-9_@./:+-]+$/.test(value) ? value : null;
  } catch { return null; }
}

// Accept only the flat metadata emitted in signed Dependabot commits.
// Unknown, ambiguous, major, or missing metadata needs manual review.
function eligibleMetadata(message) {
  const blocks = [...message.matchAll(/^---\n(updated-dependencies:\n[\s\S]*?)\n\.\.\.(?:\n|$)/gm)];
  if (blocks.length !== 1) return false;
  const dependencies = [];
  let dependency;
  for (const line of blocks[0][1].split('\n').slice(1)) {
    const name = line.match(/^- dependency-name: (.+)$/);
    if (name) {
      const parsedName = scalar(name[1]);
      if (!parsedName || !/^[@A-Za-z0-9_./-]+$/.test(parsedName)) return false;
      dependency = { name: parsedName };
      dependencies.push(dependency);
      continue;
    }
    const field = line.match(/^  (dependency-version|dependency-type|update-type): (.+)$/);
    if (!dependency || !field || Object.hasOwn(dependency, field[1])) return false;
    const value = scalar(field[2]);
    if (!value) return false;
    dependency[field[1]] = value;
  }
  return dependencies.length > 0 && dependencies.every(item =>
    item['dependency-version'] && item['dependency-type'] && TYPES.has(item['update-type']));
}

async function approveAndMerge({ github, context, core }) {
  const skip = reason => { core.info(`No automatic merge: ${reason}`); return false; };
  const repo = context.repo;
  const eventRun = context.payload.workflow_run;
  if (context.eventName !== 'workflow_run' || `${repo.owner}/${repo.repo}` !== REPOSITORY ||
      !Number.isSafeInteger(eventRun?.id) || eventRun.id <= 0) return skip('unexpected event or repository');

  // Read server state rather than trusting a stale event snapshot.
  const { data: run } = await github.rest.actions.getWorkflowRun({ ...repo, run_id: eventRun.id });
  const { data: workflow } = await github.rest.actions.getWorkflow({ ...repo, workflow_id: 'test.yml' });
  if (run.workflow_id !== workflow.id || workflow.path !== WORKFLOW || run.path?.split('@')[0] !== WORKFLOW ||
      run.event !== 'pull_request' || run.status !== 'completed' || run.conclusion !== 'success' ||
      run.run_attempt !== eventRun.run_attempt || run.head_repository?.full_name !== REPOSITORY ||
      // The API actor identifies who initiated CI; triggering_actor may be a
      // maintainer rerunning that same original bot-initiated run.
      run.actor?.login !== BOT || run.actor.id !== 49699333 ||
      !/^[a-f0-9]{40}$/.test(run.head_sha)) return skip('CI identity, result, attempt, or source does not match');
  if (run.pull_requests?.length !== 1) return skip('CI must identify exactly one pull request');
  const number = run.pull_requests[0].number;
  if (!Number.isSafeInteger(number) || number <= 0) return skip('invalid pull request association');

  const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRunAttempt,
    { ...repo, run_id: run.id, attempt_number: run.run_attempt, per_page: 100 });
  const checks = jobs.filter(job => job.name === 'run-action');
  if (checks.length !== 1 || checks[0].conclusion !== 'success') return skip('required action test did not pass');

  const validPR = pr => pr.state === 'open' && !pr.draft && pr.user?.login === BOT &&
    pr.base?.ref === 'main' && pr.base.repo?.full_name === REPOSITORY &&
    pr.head?.repo?.full_name === REPOSITORY && pr.head.sha === run.head_sha &&
    pr.head.ref?.startsWith('dependabot/') && pr.commits === 1;
  let { data: pr } = await github.rest.pulls.get({ ...repo, pull_number: number });
  if (!validPR(pr)) return skip('PR identity or current head does not match the tested update');

  const { data: commit } = await github.rest.repos.getCommit({ ...repo, ref: run.head_sha });
  if (commit.sha !== run.head_sha || !verifiedDependabotCommit(commit) ||
      !eligibleMetadata(commit.commit.message)) return skip('head lacks trusted GitHub verification, Dependabot author identity, or eligible metadata');

  // Revalidate after the reads. Mutations are bound to the tested SHA; never
  // enable an unbound auto-merge request that can survive a head change.
  ({ data: pr } = await github.rest.pulls.get({ ...repo, pull_number: number }));
  if (!validPR(pr)) return skip('PR changed during verification');
  await github.rest.pulls.createReview({ ...repo, pull_number: number, commit_id: run.head_sha,
    event: 'APPROVE', body: 'GitHub-verified signature with trusted GitHub committer and Dependabot author identity; eligible patch/minor metadata and successful Dependabot-initiated CI for this exact head.' });
  try {
    const { data: result } = await github.rest.pulls.merge({ ...repo, pull_number: number,
      sha: run.head_sha, merge_method: 'squash' });
    if (!result.merged) return skip('GitHub did not merge the pull request');
    core.info(`Merged Dependabot PR #${number} at tested head ${run.head_sha}`);
    return true;
  } catch (error) {
    if ([405, 409].includes(error.status)) return skip('head changed or branch protection currently blocks merging');
    throw error;
  }
}

module.exports = { eligibleMetadata, verifiedDependabotCommit, approveAndMerge };
