import { Fingerprint, Hash, MapPin, Sparkles, Tag, Wifi } from 'lucide-react';

import type { ItemIds } from '../../../lib/inventory';

import { DetailField, Section, TextInput } from './primitives';

export function IdentifiersSection({
  ids,
  isEditing,
  setIds,
}: {
  ids: ItemIds;
  isEditing: boolean;
  setIds: (patch: Partial<ItemIds>) => void;
}) {
  const hasIds = !!(ids.serial || ids.part || ids.uid || ids.mac || ids.assetTag || ids.location);
  if (!isEditing && !hasIds) return null;

  return (
    <Section icon={Fingerprint} title="Identifiers">
      <DetailField
        label="UID"
        icon={Sparkles}
        value={ids.uid}
        editing={isEditing}
        mono
        input={
          <TextInput
            value={ids.uid}
            onChange={(v) => setIds({ uid: v })}
            placeholder="Auto-assigned"
            mono
          />
        }
      />
      <DetailField
        label="Serial #"
        icon={Hash}
        value={ids.serial}
        editing={isEditing}
        mono
        input={
          <TextInput
            value={ids.serial}
            onChange={(v) => setIds({ serial: v })}
            placeholder="Manufacturer serial"
            mono
          />
        }
      />
      <DetailField
        label="Part #"
        icon={Hash}
        value={ids.part}
        editing={isEditing}
        mono
        input={
          <TextInput
            value={ids.part}
            onChange={(v) => setIds({ part: v })}
            placeholder="Manufacturer part / model config"
            mono
          />
        }
      />
      <DetailField
        label="MAC"
        icon={Wifi}
        value={ids.mac}
        editing={isEditing}
        mono
        input={
          <TextInput
            value={ids.mac}
            onChange={(v) => setIds({ mac: v })}
            placeholder="AA:BB:CC:DD:EE:FF"
            mono
          />
        }
      />
      <DetailField
        label="Asset tag"
        icon={Tag}
        value={ids.assetTag}
        editing={isEditing}
        mono
        input={
          <TextInput
            value={ids.assetTag}
            onChange={(v) => setIds({ assetTag: v })}
            placeholder="Internal asset tag"
            mono
          />
        }
      />
      <DetailField
        label="Location"
        icon={MapPin}
        value={ids.location}
        editing={isEditing}
        input={
          <TextInput
            value={ids.location}
            onChange={(v) => setIds({ location: v })}
            placeholder="Office · rack · shelf"
          />
        }
      />
    </Section>
  );
}
