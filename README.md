# hello-world-action

This repository demonstrates how to release a GitHub Action written in JavaScript without including the dist/ directory, enhancing supply chain security.

Dependabot patch and minor updates are automatically approved and squash-merged
only after successful CI for the exact current PR head. Major, unrecognized, or
multi-commit updates require manual review. The privileged `workflow_run` job
loads its workflow, pinned actions, and policy script from the trusted default
branch revision, and reads PR/run/commit metadata through GitHub's API. It never
checks out candidate code or consumes candidate artifacts.

The policy checks the CI workflow identity and attempt, successful `run-action`
job, open non-draft same-repository Dependabot PR targeting `main`, unchanged
head, and verified bot-signed commit metadata. Every dependency in that commit
must identify a patch or minor update. Unknown metadata fails closed. Approval
and the merge request are bound to the tested SHA; this is a deterministic
policy review, not an AI code review. Branch protection still applies. If the
head or base changes, merging is refused until Dependabot updates the branch
and successful CI triggers verification again. Infrastructure/API failures are
visible; rerun the current PR's Test Action workflow to retry.

Test the policy without contacting GitHub or mutating a PR:

```sh
node --test .github/scripts/dependabot-policy.test.cjs
```

The `main` branch requires the GitHub Actions `run-action` and `policy-tests` checks, with the branch
up to date before merging. That check installs dependencies,
builds the proposed action, runs it, and verifies its time output. Repository
GitHub Actions pull request approvals must remain enabled. The policy uses a
SHA-bound merge request after CI, rather than a pending auto-merge request.
