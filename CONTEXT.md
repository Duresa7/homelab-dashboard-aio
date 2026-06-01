# Homelab Dashboard

A single-page dashboard that aggregates live telemetry from a home lab (network gear, hypervisor, NAS, cameras, GPU, host sensors) behind one Express proxy and renders it in a React client. This file fixes the domain vocabulary; architecture vocabulary (module, seam, depth, adapter) lives in the reviewer's LANGUAGE.md, not here.

## Language

**Integration**:
One upstream homelab source the dashboard reads — `unifi`, `proxmox`, `docker`, `gpu`, `sensors`, `unas`, `protect`. Each has an enabled flag, a configured check, and a fetch. The server proxies it; the client polls it.
_Avoid_: service, plugin, provider.

**Poller**:
The client-side interval fetcher for one **Integration** (in `telemetry.ts`). Owns its cadence and writes its slice of **DashboardState**.
_Avoid_: fetcher, worker, job.

**DashboardState**:
The single client-side aggregate every page reads — one slice per **Integration** plus derived slices (`cpu`, `ram`, `storage`). Mutated in place by the pollers.
_Avoid_: store, model, global state.

### Sensors integration

**Sensor tree** (`SensorTree`):
The parsed output of `sensors -j` (lm-sensors): `cpuTempC`, `systemTempC`/`systemTempLabel`, and the `cores`/`disks`/`memory`/`network`/`fans`/`other` reading arrays. The shape is mirrored by `DashboardState['sensors']` on the client.
_Avoid_: sensor data, readings blob.

**Disk inventory** (`DiskInfo[]`):
The normalized list of physical disks derived from `lsblk -J`, each with a `kind` (`nvme`/`sata`), a **disk display name**, path, and serial. Feeds the **Sensor tree** so temperature readings get friendly disk labels instead of `nvme0`/`drivetemp-scsi-0-0`.
_Avoid_: drives, block devices.

**Disk display name**:
The human-readable label for a disk, derived from its raw model/vendor strings by per-vendor detection (Crucial, Western Digital, Seagate, Samsung, Kingston, Toshiba/Kioxia, HGST) — e.g. `ST4000VN008` → "IronWolf 4TB".
_Avoid_: disk label, model string.

## Example dialogue

> **Dev:** When the NAS reports a hot disk, where does the friendly name come from?
> **Expert:** The **sensors integration** runs two commands. `lsblk` gives the **disk inventory** — that's where each `nvme0`/`sdb` gets a **disk display name** like "IronWolf 4TB". Then `sensors -j` gives temperatures, and we stitch the two into the **sensor tree**, matching readings to inventory by order.
> **Dev:** So if `lsblk` fails but `sensors` works?
> **Expert:** You still get a **sensor tree** — temps are present, names just fall back to "SATA 1", "NVMe 2". That degradation is the integration's job, not the parser's. The parser is pure: bad input throws.
> **Dev:** And the client?
> **Expert:** A **poller** hits `/api/sensors` on an interval and drops the **sensor tree** into the `sensors` slice of **DashboardState**. The Proxmox and NAS pages read it from there.
