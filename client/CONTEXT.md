# Context: Client

The React single-page client. It polls each **Integration** (see [`../CONTEXT-MAP.md`](../CONTEXT-MAP.md) for that shared term) and renders the aggregated telemetry. This file fixes the client-side domain vocabulary.

## Language

**Poller**:
The client-side interval fetcher for one **Integration** (in `telemetry.ts`). Owns its cadence and writes its slice of **DashboardState**.
_Avoid_: fetcher, worker, job.

**DashboardState**:
The single client-side aggregate every page reads — one slice per **Integration** plus derived slices (`cpu`, `ram`, `storage`). Mutated in place by the pollers.
_Avoid_: store, model, global state.

## Example dialogue

> **Dev:** How does a page get the latest sensor temperatures?
> **Expert:** It doesn't fetch anything itself. A **poller** hits `/api/sensors` on an interval and drops the server's **sensor tree** into the `sensors` slice of **DashboardState**. The Proxmox and NAS pages just read that slice — they never call the server directly.
> **Dev:** And the derived `cpu`/`ram`/`storage` slices?
> **Expert:** Same aggregate. The pollers write raw integration slices; the derived slices are computed from them and live alongside on **DashboardState**.
