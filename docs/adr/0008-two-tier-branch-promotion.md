# Two-tier branch promotion: feature → Dev → main

`main` is not just the public branch: every push to it publishes a Docker image
to GHCR, and at the time was auto-deployed to end users ([ADR
0005](0005-cd-via-ghcr-watchtower.md)). As the project grew past single-commit
features, "anything on main is live" stopped being a comfortable place for
work-in-progress to land directly.

Decision: `Dev` is a permanent integration branch. All feature work merges into
`Dev` through pull requests; `main` only advances by promoting `Dev` (a
`Dev → main` PR) when a release is intended. Pushing `Dev` deploys nothing —
the Docker publish job remains gated to pushes on `main`.

Protection (a repository setting, not tracked in the repo — recorded here):

- **Both `Dev` and `main`** require the same status checks on PRs (verify,
  secret/PII scan, dependency review; `strict` so branches must be current),
  with **no required reviewer** — a solo maintainer cannot approve their own
  PR, so a review requirement would deadlock the flow.
- **`enforce_admins` stays off on both** — the owner keeps a direct-push
  escape hatch for emergencies (a bad deploy on `main` can be fixed forward
  immediately; husky's pre-commit suite is the backstop, as in ADR 0005).
  The buffer's value comes from defaulting everything through `Dev`, not from
  making the branches physically unbypassable. Revisit if collaborators join.
- **`main` remains the default branch** — visitors and fresh clones get the
  stable release. The cost is remembering to re-target feature PRs at `Dev`
  (GitHub pre-fills the default branch).
- **CodeQL now also runs on `Dev`** (push + PR) so deep security findings
  surface when a feature merges, not weeks later at the release gate.

This supersedes the "branch protection is intentionally light" note in ADR
0005: `main`'s checks are unchanged, but direct-to-main is now an emergency
hatch rather than the everyday path.

Status: implemented
