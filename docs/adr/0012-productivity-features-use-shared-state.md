# Productivity features use shared dashboard state

The Productivity section (Kanban Boards, Subscription tracker) stores its data in the
existing shared `app_state` key-value store, visible to every authenticated user —
the same model as inventory, bookmarks, and WoL hosts. The per-user alternative
(a `user_id`-scoped table plus API filtering by the authenticated user) was
considered and rejected: it would introduce the first user-owned data model in the
app for features that, at homelab scale, are used by one household of trusted users.
Subscriptions here act as a shared ledger, not private finance.

## Consequences

- Every member can see and edit every board, card, and subscription; roles still
  gate writes (viewer = read-only) via the existing middleware matrix.
- Concurrent edits follow the store's last-write-wins semantics per state key.
  Keying boards individually (rather than one blob for all boards) bounds the
  clobber radius, but simultaneous edits to the same board can still lose one
  writer's change. Accepted at this scale.
- If per-user data is ever wanted (e.g. the dashboard grows beyond a household),
  the migration path is a `user_id`-scoped table with the shared data assigned to
  an "everyone" owner — worth a new ADR at that point.

Status: accepted
