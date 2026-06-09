# Per-node GPU + sensor telemetry is collected from each node, attributed by node name

The Proxmox cluster API already reports CPU/RAM/disk per node, but GPU and temperature
data historically came from a **single** SSH host (`GPU_SSH_HOST` / `SENSORS_SSH_HOST`)
with no node attribution — so on a multi-node cluster you could not tell which GPU or which
temperatures belonged to which node. We now collect GPU (`nvidia-smi`) and sensors
(`sensors -j`) **per node** and tag every reading with its canonical Proxmox node name.

Targets come from a `PROXMOX_NODE_TARGETS` config map (node name → SSH target), resolved by
`resolveNodeTargets` with a **single-host fallback** so existing single-host installs are
unchanged (their data is attributed to `PROXMOX_NODE`). `collectPerNode` runs the nodes
concurrently and degrades gracefully: a node with no NVIDIA GPU or no `lm-sensors` reports
nothing (it is _not_ an error), while a genuinely unreachable node is surfaced under
`unavailable[]` rather than failing the whole `/api/gpu` or `/api/sensors` payload. Nodes
that are firewalled from the dashboard host but reachable from a cluster peer are reached
via SSH **ProxyJump** (`jumpHost`).

This was chosen because node attribution is the whole point of the feature: the Overview's
per-node tiles and the Proxmox Sensors/Node views join GPU/sensor data to nodes by name, so
each stat is unambiguous. The cost is a richer config surface (the targets map) and an
extra SSH hop for firewalled peers; the single-host fallback keeps the simple case simple.
