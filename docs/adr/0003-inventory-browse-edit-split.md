# Inventory browse and edit are separate render paths

The Inventory tab bodies and detail panel render entities through the read-only shared
card kit (`EntityCard`/`SectionCard`/`ListCard`/`ListRow`/`StatusBadge`/`MetricBar`) in
**browse** mode, and through bespoke inline-editable markup (`Editable` fields, add/remove
rows, import/export) in **edit** mode — selected by the global `mode` toggle in the
masthead. Machine browse cards specifically use a non-button `SectionCard` shell with a
clickable header (opens the Machine) and `ListRow` component rows (open each Component),
preserving the dual machine/component drill-in without nesting interactive controls.

This was chosen because the card kit is deliberately read-only and presentational, while
the v2 inventory model (flat component pool, UID blocks, inline edit, JSON import/export —
see [0001](0001-rename-spareitem-to-device.md), [0002](0002-flat-component-pool.md))
requires editing in place. The alternatives were to make the shared kit editable — which
spreads edit concerns across every read-only page that consumes it — or to keep Inventory
visually divergent from the rest of the app. Splitting by mode lets browse reuse the kit
for app-wide visual consistency while edit keeps the bespoke editing surface intact.

The cost is two render paths to keep in sync for each editable surface (Machines, Device
categories): a visual or behavioural change must be applied to both. Tabular surfaces
(`ComponentTable`, the `CategoryBlock` table) are shared across modes and only toggle their
inner field affordances, so the split is narrower there. Machine browse cards use
`SectionCard` (a `div`) rather than `EntityCard` (a `button`) so component rows can stay
individually clickable.
