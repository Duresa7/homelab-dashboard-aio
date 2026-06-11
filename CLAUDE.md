# Homelab Dashboard

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues, managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-label vocabulary (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Code comments

Do **not** add unnecessary, AI-generated filler comments. Avoid comments that merely narrate what the code obviously does or restate an identifier — e.g. `// fire a slim status rail`, `// loop over items`, `// set the value`. These add noise and are not wanted anywhere in the codebase.

Only add a comment when it carries information the code itself cannot: a non-obvious _why_, a gotcha, a workaround and its reason, an invariant, or a link to relevant context. If the comment doesn't help someone understand something they couldn't get from reading the code, don't write it.

## Branch model

Three tiers:

- **`main`** — production. Only ever updated via a pull request **from `dev`**.
- **`dev`** — integration branch. Feature work lands here first via pull request.
- **feature branches** — branched off `dev`; one per change.

Flow: branch off `dev` → open a PR into `dev` → once the change is reviewed, passing, and ready for production, open a PR **from `dev` into `main`**. Never PR a feature branch directly into `main`.

## Commit conventions

Do **not** add `Co-Authored-By` trailers (or any other attribution) crediting AI agents — Claude, Copilot, Cursor, etc. — to commits, PRs, or any contribution. No AI co-authorship attribution anywhere.
