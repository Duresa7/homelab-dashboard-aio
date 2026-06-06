# Components live in one flat pool, not nested under machines

Components are stored in a single flat pool (`Inventory.components[]`), each carrying a
stable UID and an `assignment` that points to a Machine or to `SPARE` — rather than being
nested inside the Machine that contains them. This was chosen so a user can freely move a
part between machines or to/from spare while the part keeps the same UID for life, and so
installed and spare parts live in one place. The cost is indirection: callers resolve a
Machine's parts by filtering the pool on `assignment` (`machineComponents()`).
