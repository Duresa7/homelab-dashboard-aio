# Context Map — Homelab Dashboard

A single-page dashboard that aggregates live telemetry from a home lab (network gear, hypervisor, NAS, GPU, host sensors) behind one Express proxy and renders it in a React client.

This repo is split into two domain contexts. Read the `CONTEXT.md` for whichever context you're working in; read both when your change crosses the seam between them. Architecture vocabulary (module, seam, depth, adapter) lives in the reviewer's LANGUAGE.md, not here.

## Contexts

| Context    | Glossary                                 | Scope                                                                                 |
| ---------- | ---------------------------------------- | ------------------------------------------------------------------------------------- |
| **server** | [`server/CONTEXT.md`](server/CONTEXT.md) | The Express proxy and upstream adapters — sensor/disk parsing, per-integration fetch. |
| **client** | [`client/CONTEXT.md`](client/CONTEXT.md) | The React client — pollers, the DashboardState aggregate, pages.                      |

## Shared boundary term

**Integration**:
One upstream homelab source the dashboard reads — `unifi`, `proxmox`, `docker`, `gpu`, `sensors`, `unas`. Each has an enabled flag, a configured check, and a fetch. The **server** proxies it; the **client** polls it. This is the one term both contexts share — defined here because it names the seam between them.
_Avoid_: service, plugin, provider.

## Example dialogue (crosses the seam)

> **Dev:** When the NAS reports a hot disk, where does the friendly name come from?
> **Expert:** The **sensors integration** (server) runs two commands. `lsblk` gives the **disk inventory** — that's where each `nvme0`/`sdb` gets a **disk display name** like "IronWolf 4TB". Then `sensors -j` gives temperatures, and we stitch the two into the **sensor tree**, matching readings to inventory by order.
> **Dev:** So if `lsblk` fails but `sensors` works?
> **Expert:** You still get a **sensor tree** — temps are present, names just fall back to "SATA 1", "NVMe 2". That degradation is the integration's job, not the parser's. The parser is pure: bad input throws.
> **Dev:** And the client?
> **Expert:** A **poller** (client) hits `/api/sensors` on an interval and drops the **sensor tree** into the `sensors` slice of **DashboardState**. The Proxmox and NAS pages read it from there.
