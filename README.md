# hello-world-action

This repository demonstrates how to release a GitHub Action written in JavaScript without including the dist/ directory, enhancing supply chain security.

Dependabot patch and minor updates are automatically approved and queued for
squash merge. Major updates require manual review. The automation verifies
Dependabot's update metadata and signed commits; it does not perform an AI code
review. The `pull_request` entry workflow calls the privileged approval workflow
explicitly from protected `main`. The called workflow's action pins therefore
come from `main`, even when Dependabot proposes updating those pins in a PR.
The approval workflow never checks out or executes the candidate repository
code. Its explicit write permissions allow approvals and auto-merge without
Dependabot's `pull_request_target` read-only token restriction.

The `main` branch requires the GitHub Actions `run-action` check, with the branch
up to date before merging. That check installs dependencies,
builds the proposed action, runs it, and verifies its time output. Repository
auto-merge and GitHub Actions pull request approvals must remain enabled.
