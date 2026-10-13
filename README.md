# hello-world-action

A JavaScript GitHub Action that greets a name and returns the local greeting
time. Source development happens on `main`; release tags contain the bundled
runtime in `dist/index.js`. Omitting generated files from source branches makes
source changes easier to review, but does not independently establish supply
chain security.

## Use a published release

```yaml
- name: Greet
  id: greeting
  uses: jingairpi/hello-world-action@255859c8d3e42c75b7690052192f094410e28af0 # v1.12.0
  with:
    who-to-greet: world

- name: Print the greeting time
  env:
    GREETING_TIME: ${{ steps.greeting.outputs.time }}
  run: printf '%s\n' "$GREETING_TIME"
```

The published `v1.12.0` release uses Node.js 24 and requires a runner that
supports that action runtime. Pin a published release's full commit SHA for
reproducibility.

`main` has no bundled runtime and is not a usable action reference. GitHub's
release source archives include the tagged `action.yml` and `dist/` tree.

`who-to-greet` defaults to `world` and accepts a single line. The `time` output is
a local time string with a timezone offset; it is not an ISO timestamp.

## Development and verification

Use Node.js 24, then run:

```sh
npm ci
npm run build
npm test
```

`npm test` runs the Dependabot policy, bundled-action, and release-publication
tests. Build first so the action tests exercise the current source bundle.

Pull request CI builds and tests the proposed source and executes its bundled
action. The `main` branch requires the GitHub Actions `run-action` check, with
the branch up to date before merging. Passing these checks proves the tested
behaviors, not comprehensive dependency security.

## Release a new version

Enable GitHub immutable releases in repository settings before the first release
with this workflow. This setting protects newly published releases; it does not
retroactively qualify or lock the historical releases.

Run **Release CI** using **Run workflow**, select **main**, and supply an unused
tag in exactly `vMAJOR.MINOR.PATCH` form. Leading zeroes,
prerelease suffixes, and mutable major-version aliases are not supported. The
workflow accepts no source override: it builds the exact `main` commit recorded
when the workflow was dispatched, even if `main` advances while it runs.

The read-only build job installs the locked dependencies, builds the bundle, and
runs the tests on Node.js 24. A separate publication job retrieves that run's
tested bundle, creates a release commit whose parent is the selected source
commit, and pushes a new tag pointing to the complete tree. Publication never
merges a newer `main`, force-updates a tag, or creates a temporary release branch.
Concurrent release runs are serialized, and a duplicate version fails. Another
dispatch does not cancel a running publication. GitHub permits one pending run
in the concurrency group; a newer dispatch can replace an older pending run.

The workflow then creates a draft GitHub Release and publishes it. Release notes
record both source and release commit SHAs. It verifies that GitHub reports the
published release as immutable. A workflow success confirms these steps;
merging source changes alone creates no release or consumer update. Existing
tags and releases remain unchanged.

If a run fails before the tag push because of a transient service or runner
problem, rerun the workflow. [Reruns keep the original source SHA](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs);
if the repair changes source or workflow code, merge that repair and dispatch a
new run from the corrected `main`. The same version remains available if its
tag was never pushed.

The tested bundle is retained for seven days. If it has expired, retrying only
the publication job cannot retrieve it; rerun all jobs to rebuild and test the
same source, provided no tag was pushed.

If a run fails after the tag push, the complete action tree remains at that tag,
and rerunning the workflow deliberately refuses to replace it. Inspect the
failed run and verify the tag's source parent, bundled tree, and recorded
build/test results.
Then explicitly finish creating or publishing the release for that existing
tag in GitHub, with immutable releases enabled. If publication already succeeded
and only the final verification failed, inspect the release's `immutable` field
and repository settings. Do not delete or move an existing tag to retry a build;
publish a new version for any source or bundle change.

## Dependabot automation

The automation workflow is currently disabled pending explicit authorization
to resume automatic merges. Merging changes to its code does not authorize
re-enabling it. Check the workflow state in GitHub Actions before relying on it.

When enabled, Dependabot automation runs its privileged review and merge logic
from the default branch after successful CI.

It validates the associated Dependabot PR and current head SHA through GitHub's
API. The CI run's original actor must be the authenticated Dependabot account;
a human may rerun that same bot-initiated run.

The commit must identify Dependabot as author, GitHub's trusted `web-flow`
account as committer, and have a GitHub-verified signature. Human-signed
amendments retaining the bot author are rejected. This checks the observed
GitHub-generated commit provenance; author attribution alone does not prove
which actor initiated a change.

All signed metadata entries must identify patch or minor updates. Major,
unrecognized, or multi-commit updates require manual review, including security
updates whose metadata omits the update type.

It approves and merges only the validated SHA; it does not perform an AI code
review or execute candidate code in its privileged job.

GitHub Actions pull request approvals must remain enabled. Branch protection
remains the final merge gate. Workflow configuration and local tests alone do
not prove that a future hosted Dependabot approval and merge will work.
