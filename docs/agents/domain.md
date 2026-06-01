# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

This is a **multi-context** repo: a `CONTEXT-MAP.md` at the root points at one `CONTEXT.md` per context (`client/` and `server/`).

## Before exploring, read these

- **`CONTEXT-MAP.md`** at the repo root — it names each context and points at its `CONTEXT.md`. Read the context glossary relevant to your topic; read both when your change crosses the client/server seam.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in. Also check `client/docs/adr/` or `server/docs/adr/` for context-scoped decisions if they exist.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The producer skill (`/grill-with-docs`) creates them lazily when terms or decisions actually get resolved.

## File structure

```
/
├── CONTEXT-MAP.md                    ← names the contexts, defines shared boundary terms
├── docs/adr/                         ← system-wide decisions
├── client/
│   └── CONTEXT.md                    ← Poller, DashboardState
└── server/
    └── CONTEXT.md                    ← Sensors integration: Sensor tree, Disk inventory, …
```

Context-scoped ADRs, if introduced later, live at `client/docs/adr/` and `server/docs/adr/`.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in the relevant `CONTEXT.md` (or the shared term in `CONTEXT-MAP.md`). Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/grill-with-docs`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_
