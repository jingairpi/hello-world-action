# hello-world-action

This repository demonstrates how to release a GitHub Action written in JavaScript without including the dist/ directory, enhancing supply chain security.

Dependabot patch and minor updates are automatically approved and queued for
squash merge. Major updates require manual review. The automation verifies
Dependabot's update metadata and signed commits; it does not perform an AI code
review. The privileged approval workflow never executes pull request code.

The `main` branch requires the GitHub Actions `run-action` check, with the branch
up to date before merging. That check installs dependencies,
builds the proposed action, runs it, and verifies its time output. Repository
auto-merge and GitHub Actions pull request approvals must remain enabled.
