# Homelab Dashboard — TODO

## Completed

### UI

| Item                                                          | Completed  |
| ------------------------------------------------------------- | ---------- |
| Rename "Reference" nav group to "Utilities"                   | 2026-06-09 |
| Add a "Tools" page under Utilities and move Wake-on-LAN there | 2026-06-09 |
| Optional traditional top-bar navigation (Settings toggle)     | 2026-06-09 |

### Data Center (Proxmox)

| Item                                                                                                                                               | Completed  |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Multi-GPU support + vendor detection (NVIDIA / AMD / Intel / integrated) — verified live; AMD metric mapping still needs real-hardware check (#47) | 2026-06-09 |
| Per-node tables for Guests / Storage / Disks (combined table stays default) + Guest filters by name / ID / node / IP / state                       | 2026-06-09 |

### NAS

| Item                                                 | Completed  |
| ---------------------------------------------------- | ---------- |
| Overview tab for NAS (matching Network/Server style) | 2026-06-09 |

### Containers

| Item                                                                     | Completed  |
| ------------------------------------------------------------------------ | ---------- |
| Overview tab for Containers (matching Network/Server style)              | 2026-06-09 |
| Clarify container data source (state that data is fetched via Portainer) | 2026-06-09 |

### Network (UniFi)

| Item                                                                | Completed  |
| ------------------------------------------------------------------- | ---------- |
| Config cards (Networks/VLANs, etc.) rendered as tables with headers | 2026-06-09 |
| Firewall detail page — full zones + policies on click               | 2026-06-09 |

### Settings & UX

| Item                                                    | Completed  |
| ------------------------------------------------------- | ---------- |
| Selectable real-time vs. delayed telemetry refresh rate | 2026-06-09 |
| Adjustable row cap on list cards (device/client counts) | 2026-06-09 |
| More precise graphs for spotting dips                   | 2026-06-09 |

### Inventory

| Item                                                                                            | Completed  |
| ----------------------------------------------------------------------------------------------- | ---------- |
| Component image uploads — authenticated attachments, lightbox viewer, server storage + GC (#42) | 2026-06-10 |

### Security

| Item                                                                                          | Completed  |
| --------------------------------------------------------------------------------------------- | ---------- |
| Mandatory login + role-based access — argon2id hashing, TOTP, rate limiting, proxy-auth (#41) | 2026-06-10 |

---

## Open (GitHub Issues)

### Network

| Issue                                                             | Description                                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------------ |
| [#39](https://github.com/Duresa7/homelab-dashboard-aio/issues/39) | Support non-UniFi network gear (Cisco, MikroTik, and others) |

### Devices

| Issue                                                             | Description                                                     |
| ----------------------------------------------------------------- | --------------------------------------------------------------- |
| [#40](https://github.com/Duresa7/homelab-dashboard-aio/issues/40) | SSH-free collection path — native or API-based (not a priority) |

### Data Center

| Issue                                                             | Description                                    |
| ----------------------------------------------------------------- | ---------------------------------------------- |
| [#43](https://github.com/Duresa7/homelab-dashboard-aio/issues/43) | Support multiple datacenters                   |
| [#47](https://github.com/Duresa7/homelab-dashboard-aio/issues/47) | Verify AMD GPU metric mapping on real hardware |

### Storage

| Issue                                                             | Description                                       |
| ----------------------------------------------------------------- | ------------------------------------------------- |
| [#45](https://github.com/Duresa7/homelab-dashboard-aio/issues/45) | UNAS: show M.2 slots, uptime, and per-drive names |

### UI

| Issue                                                             | Description                                                   |
| ----------------------------------------------------------------- | ------------------------------------------------------------- |
| [#46](https://github.com/Duresa7/homelab-dashboard-aio/issues/46) | Custom icons + automatic vendor icons (Proxmox, Cisco, WD, …) |
| [#44](https://github.com/Duresa7/homelab-dashboard-aio/issues/44) | Per-hardware severity thresholds (per CPU/GPU type)           |

### Onboarding

| Issue                                                             | Description                                                         |
| ----------------------------------------------------------------- | ------------------------------------------------------------------- |
| [#48](https://github.com/Duresa7/homelab-dashboard-aio/issues/48) | Simpler, automated onboarding — auto-detect cluster vs. single node |
