# Factory bootstrap

Goal: deploy the Goalpost factory for Zenmium and wire intake so issue #3 runs unattended to a draft PR. Parent spec: `docs/zenmium/PLAN.md`. Security lane: `docs/zenmium/SECRETS.md`.

## Preconditions

- Vercel account that owns the project. The CLI reports the active user as `tp-solvys`.
- GitHub access to `nicharacci/zenmium`. The `gh` CLI reports `nicharacci`.
- 1Password for every value, through the browser extension in Zen. No CLI. Operating the browser needs a browser MCP wired into opencode and the browser running.
- Do not build locally. Capacity is Critical (about 7 GB free) and the factory needs Node 24.x while local is 22.22.3. Builds happen on Vercel.

## Steps

1. Import the repo into Vercel. In the Vercel dashboard, Add New then Project, import `nicharacci/zenmium`. The framework auto-detects as eve. Vercel builds in its own environment, so nothing installs on this Mac.
2. Create the connectors. Run `vercel connect create github/goalpost-factory-agent` and `vercel connect create linear/goalpost-factory-agent`, then attach both to the project. Record the UIDs by name only.
3. Set project environment. `GITHUB_CONNECTOR`, `LINEAR_CONNECTOR`, and `FACTORY_REPO=nicharacci/zenmium`. Optional `FACTORY_SETUP_COMMAND="pnpm install"`.
4. Install the GitHub App behind `GITHUB_CONNECTOR` with access to `nicharacci/zenmium`. Subscribe its webhook to `issues`, `issue_comment`, `pull_request_review_comment`, `pull_request`, and `check_suite` at `/eve/v1/github`. Point the Linear trigger at `/eve/v1/linear`.
5. Deploy. The Vercel Git integration builds on push. `eve deploy` is the canonical production command from a checkout. Confirm the deployment is live.
6. Verify intake. Confirm the GitHub channel receives events, then trigger issue #3 by adding a progress comment or re-applying the `factory` label.

## Verification

- Health: the deployment responds, and `eve info` reports zero errors and zero warnings from a Cloud or CI checkout.
- Dispatch: issue #3 produces a classifier result and a progress comment on the issue.
- Ceiling: the run ends in a draft PR. It never pushes to `main`.

## What the agent can and cannot do here

- Can: prepare this runbook and the exact commands, verify repo and CLI identity, and open or adjust issues.
- Cannot: operate Zen's 1Password extension (no browser tool is wired into this opencode session), import the repo into Vercel, or reach any value. The human gates are the browser tool setup and the Vercel import.

## Names only

`GITHUB_CONNECTOR`, `LINEAR_CONNECTOR`, `FACTORY_REPO`, `FACTORY_SETUP_COMMAND`. Values come from 1Password or Vercel Connect. None appear here.
