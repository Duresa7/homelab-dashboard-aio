# Homelab Dashboard — Domain Glossary

A single-page dashboard that aggregates telemetry from a home lab (compute, network,
storage, sensors, security logs) and tracks the physical hardware inventory behind it.
This glossary fixes the vocabulary; it is not a spec.

## Language

### Inventory

**Machine**:
A host chassis whose internal parts you track and reassign individually as Components
(built/upgradable PCs, servers, the NAS). The test: _do you track and swap its guts?_
_Avoid_: rig, box, node (reserve "node" for Proxmox).

**Device**:
A unit tracked as a whole — even if it contains a CPU/RAM — whose internals you do NOT
track as separate Components (laptop, phone, printer, camera, network gear). The
complement of Machine. Umbrella term for non-Machine hardware.
_Avoid_: appliance (reserve for the live network view), gadget, peripheral (that's one category).

**Component**:
A replaceable part — cpu, gpu, motherboard, ram, storage, psu, cooler, case, nic, other.
Lives in the Component pool, never nested inside a Machine.
_Avoid_: part (informal alias), peripheral.

**Component pool**:
The one flat list holding _all_ Components, installed or spare. A Component points to its
Machine via Assignment; reassigning is just changing that pointer, and the UID never moves.

**Device category**:
A grouping of Devices by kind (laptop, phone, printer, network, peripheral, monitor,
camera, other) that drives the UID block and icon.
_Avoid_: spare category.

**Deployment**:
_Whether_ a unit is in active use (`in-service`) or stored (`spare`). Carried by whole
units (Machine, Device). A separate axis from Status.
_Avoid_: state, status (Status is a different axis).

**Assignment**:
_Where_ a Component lives — a specific Machine, or the spare pool (`SPARE`). A Component
has no Deployment field: assigned to a Machine ⇒ in-service, `SPARE` ⇒ spare. So
Assignment answers WHERE and implies WHETHER.

**Spare**:
Not in active service ("in the drawer"). One concept, two mechanisms: whole units via
`deployment = spare`; Components via `assignment = SPARE`.

**Status**:
Condition/health of an item — `working | broken | in-repair | retired`. Independent of
Deployment: a spare part can be `working`; an in-service one can be `broken`.
_Avoid_: state, deployment.

**UID**:
A stable, human-readable inventory number from a type/category block (CPUs in the 1000s,
machines in the 0800s, …). Survives renaming and reassignment — one physical item, one ID for life.

**Nickname**:
An optional, user-chosen friendly display name offered for Machines and notable Devices
(servers, computers, network gear) — never for Components. When present it is the on-screen
label, but it carries no identity weight; canonical identity is the hostname/model/IP.
(The owner's Star Wars theme is a personal convention, not a model rule.)

### Bookmarks

**Bookmark**:
A saved link to a service — a name, a URL, and an icon — that you click to launch
(opens in a new tab). The "Apps" tile is the display of your Bookmarks.
_Avoid_: app (that's only the tile's display label), shortcut, link.

**Group** (Bookmarks):
A labeled cluster of Bookmarks (e.g. "Media", "Infra"). Every Bookmark belongs to exactly
one Group; a default Group always exists so none are orphaned.
_Avoid_: category (reserved for syslog event types), section (reserved for dashboard sections),
folder.

### Compute

**Node** (Proxmox):
A Proxmox host — a member of the virtualization cluster that runs VMs and LXCs.
_Avoid_: machine (reserve for inventory), server, host.

**VM**:
A full virtual machine (QEMU guest) running on a Node.

**LXC**:
A lightweight Linux container running on a Node. Distinct from a Docker Container.

**Proxmox storage**:
A storage backend a Node writes to (local-lvm, ZFS, NFS, …). Distinct from a UNAS Pool.

**Docker host**:
A Docker daemon / Portainer endpoint that runs Containers.
_Avoid_: node, server.

**Container**:
A Docker workload running on a Docker host. Distinct from a Proxmox VM/LXC.

**Stack**:
A Docker Compose project grouping related Containers.

### Network

**Network appliance**:
The live-telemetry view of a Network-category Device — your UniFi Gateway, Switch, or
Access Point. Same physical box as the inventory Device, surfaced as live state.

**Gateway / Switch / Access Point (AP)**:
The three UniFi appliance kinds — edge router, L2 switch, WiFi radio respectively.

**Network** (UniFi):
A logical network / VLAN segment (WAN | LAN | GUEST). Not a physical thing.
_Avoid_: subnet (when you mean the VLAN object), LAN (one management type).

**SSID**:
A broadcast WiFi name. Many SSIDs can ride on one AP.

**Client**:
An endpoint connected to the network (wireless, wired, or VPN). A high-traffic client
surfaced in stats is a **Top talker**.

### Storage (NAS)

**Pool** (UNAS):
A RAID/JBOD storage pool on the NAS appliance. Distinct from Proxmox storage.

**Disk** (UNAS):
A physical drive in a NAS slot, with SMART health.

**Scrub**:
A pool integrity/maintenance pass over a UNAS Pool.

### Sensors

**Sensor**:
A single hardware reading from a node — a temperature probe, fan RPM, etc. On a multi-node
cluster, GPU and sensor readings are collected per node and **attributed by Proxmox node
name** (see ADR 0004), so a reading is never ambiguous about which node produced it.

**Node target**:
An entry in the `PROXMOX_NODE_TARGETS` map telling the backend how to reach one node's
`nvidia-smi` / `sensors` (SSH host, optional jump host through a reachable peer). Without a
map, the single GPU/sensor host is used and attributed to the primary node.

**Core**:
One CPU core's utilization within the CPU telemetry.

**Fan**:
A cooling fan reading (rpm + target).

### Observability

**Syslog event**:
A parsed syslog line received from network gear over UDP/514, classified by Category,
Source kind, and Severity.

**Source kind** (`deviceKind`):
The class of network appliance that emitted a Syslog event (gateway | ap | switch |
controller | unknown). A classifier on the log source, not a new kind of thing.

**Category**:
The type of a Syslog event (firewall, client, ids, vpn, admin, update, system,
monitoring, security, threat).

**Severity**:
Standard syslog numeric level 0–7. The UI collapses it to bad (0–3) / warn (4) / info (5–7).

**Alert** / **Event** / **Backup** / **UPS**:
Dashboard-level activity items — a live issue, a logged occurrence, a snapshot status, and
the battery backup respectively.

### Platform

**Capability**:
A toggleable dashboard feature backed by an integration (datacenter, network, nas,
containers, gpu, sensors, logs). Drives which Sections appear.

**Integration / Provider**:
The server-side adapter that talks to an external system (Proxmox, UniFi, Docker/Portainer,
NVIDIA, sensors, syslog) and feeds a Capability.

### Auth

**User**:
A local account (username + display name + optional email + argon2id password hash) stored
in the state DB. The username is the lowercase login id; the display name carries the
person's casing. There is no email delivery — recovery is admin reset or the offline CLI.

**Role**:
One of admin / member / viewer, enforced server-side by the central matrix in
`server/src/auth/middleware.ts`. Viewer = read-only, Member = inventory writes + WoL,
Admin = setup, users, debug endpoints.

**Session**:
A 30-day sliding login persisted in the `sessions` table; the cookie holds a random token,
the DB holds only its SHA-256. "Remember me" controls whether the cookie outlives the browser.

**Bootstrap mode**:
The state when the active DB has zero users: every API route is gated off except auth
status + first-admin creation, and the client forces the create-admin screen. Covers fresh
installs, upgrades, and DB-backend switches with one invariant.

**Proxy auth**:
Optional header-based SSO (Authentik/Authelia style): a trusted reverse proxy asserts a
username that must map to an existing local User. The header picks _who logs in_, never
who exists or what role they hold. See ADR 0006.

## Flagged ambiguities

- **Device**: inventory umbrella (sealed unit tracked whole) vs UniFi **network appliance**
  (live view of a Network-category Device) vs SIEM **source kind** (`deviceKind`). Resolved:
  one umbrella ("Device"), with "network appliance" and "source kind" as the narrower views.
- **Host**: a Docker host (daemon endpoint) is NOT an inventory Machine and NOT a syslog
  `hostname` (a string label on a Syslog event). Prefer the qualified term every time.
- **Node**: always means a **Proxmox** host. Never use it for an inventory Machine or a Docker host.
- **Storage**: **Proxmox storage** (VM backend) ≠ **Pool** (UNAS physical pool) ≠ host disk
  sensors. Qualify which layer you mean.
- **Container** (Docker) ≠ **VM/LXC** (Proxmox): different runtimes, different subsystems.

## Example dialogue

> **Dev:** The NAS is in the network rack — is it a Device?
> **Owner:** No, it's a Machine — I track its disks as Components and swap them.
> **Dev:** And its disks show up under the NAS telemetry too?
> **Owner:** Right — same physical drives. Inventory is the asset record; the NAS page is
> live state. Asset vs live entity.
> **Dev:** If I pull a drive and shelve it?
> **Owner:** Its Assignment flips to SPARE. Same UID, still `working` Status — just not in
> service. It never leaves the Component pool.
> **Dev:** The gateway's nickname is "Front Gateway" — is that its identity?
> **Owner:** No, that's cosmetic. Identity is the model/IP. The nickname's just the label I see.
