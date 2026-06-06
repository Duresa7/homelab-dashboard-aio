# Rename SpareItem/SpareCategory → Device/DeviceCategory

The inventory types `SpareItem` / `SpareCategory` (and `Inventory.spares`) predate the v7
model in which a "spare" item gained an `in-service | spare` deployment toggle — so the
"Spare" name is now a misnomer (the live UniFi gateway is a `SpareItem` that is in service).
We will rename them to `Device` / `DeviceCategory` (and `Inventory.spares` → `devices`) to
match the glossary and the already-canonical `DeviceCategoryType` / `deviceType`. Deferred
as a tracked refactor because it changes the persisted SQLite inventory shape and needs a
one-time migration.

Status: accepted (implementation pending — tracked separately)
