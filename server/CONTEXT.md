# Context: Server

The Express proxy. It fronts every upstream **Integration** (see [`../CONTEXT-MAP.md`](../CONTEXT-MAP.md) for that shared term), runs each integration's configured check and fetch, and normalizes the result before the client polls it. This file fixes the server-side domain vocabulary.

## Sensors integration

**Sensor tree** (`SensorTree`):
The parsed output of `sensors -j` (lm-sensors): `cpuTempC`, `systemTempC`/`systemTempLabel`, and the `cores`/`disks`/`memory`/`network`/`fans`/`other` reading arrays. The shape is mirrored by `DashboardState['sensors']` on the client.
_Avoid_: sensor data, readings blob.

**Disk inventory** (`DiskInfo[]`):
The normalized list of physical disks derived from `lsblk -J`, each with a `kind` (`nvme`/`sata`), a **disk display name**, path, and serial. Feeds the **Sensor tree** so temperature readings get friendly disk labels instead of `nvme0`/`drivetemp-scsi-0-0`.
_Avoid_: drives, block devices.

**Disk display name**:
The human-readable label for a disk, derived from its raw model/vendor strings by per-vendor detection (Crucial, Western Digital, Seagate, Samsung, Kingston, Toshiba/Kioxia, HGST) — e.g. `ST4000VN008` → "IronWolf 4TB".
_Avoid_: disk label, model string.

## Compute

**Compute**:
The dashboard section for host-level control actions such as Wake-on-LAN. A **Host** in this section is persisted through the generic state store under the `computeHosts` key.
_Avoid_: machines, servers.

**Host**:
A stored Wake-on-LAN target with shape `{ id, name, mac, broadcast?, port? }`. `id` is the stable client-generated identifier, `name` is the display name, `mac` is the normalized hardware address, and optional `broadcast`/`port` override the Wake-on-LAN defaults (`255.255.255.255` and `9`).
_Avoid_: device, node.

## Example dialogue

> **Dev:** When the NAS reports a hot disk, where does the friendly name come from?
> **Expert:** The **sensors integration** runs two commands. `lsblk` gives the **disk inventory** — that's where each `nvme0`/`sdb` gets a **disk display name** like "IronWolf 4TB". Then `sensors -j` gives temperatures, and we stitch the two into the **sensor tree**, matching readings to inventory by order.
> **Dev:** So if `lsblk` fails but `sensors` works?
> **Expert:** You still get a **sensor tree** — temps are present, names just fall back to "SATA 1", "NVMe 2". That degradation is the integration's job, not the parser's. The parser is pure: bad input throws.
