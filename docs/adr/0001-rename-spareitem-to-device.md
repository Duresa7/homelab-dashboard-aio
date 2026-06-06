# Rename SpareItem/SpareCategory -> Device/DeviceCategory

The inventory types `SpareItem` / `SpareCategory` (and `Inventory.spares`) predated the v7
model in which a "spare" item gained an `in-service | spare` deployment toggle, making the
old name a misnomer.

Implemented: the code now uses `Device` / `DeviceCategory` / `DeviceColumn` and
`Inventory.devices`, while `DeviceCategoryType` / `deviceType` remain the canonical category
names. Persisted inventory blobs with the old `spares` key are migrated to `devices` by the
client inventory migration and by the server state DB migration.

Status: implemented
