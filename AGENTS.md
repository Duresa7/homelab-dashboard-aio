# AGENTS.md

Agent configuration for the Homelab Dashboard repo.

## Agent skills

### Issue tracker

Issues and PRDs are tracked as local markdown files under `.scratch/<feature-slug>/` (this repo's GitHub remote is not used for issues). See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles use their default strings (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), recorded on a `Status:` line in each issue file. See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context: `CONTEXT-MAP.md` at the root points at `client/CONTEXT.md` and `server/CONTEXT.md`. See `docs/agents/domain.md`.
