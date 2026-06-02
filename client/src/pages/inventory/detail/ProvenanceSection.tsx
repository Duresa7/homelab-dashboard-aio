import { Briefcase, Calendar, Hash, Receipt, ShieldCheck, Tag } from 'lucide-react';

import type { PurchaseInfo } from '../../../lib/inventory';

import { DateInput, DetailField, Section, TextInput, warrantyHint } from './primitives';

export function ProvenanceSection({
  purchase,
  isEditing,
  setPurchase,
}: {
  purchase: PurchaseInfo;
  isEditing: boolean;
  setPurchase: (patch: Partial<PurchaseInfo>) => void;
}) {
  const hasPurchase = !!(
    purchase.date ||
    purchase.vendor ||
    purchase.price ||
    purchase.receiptRef ||
    purchase.warrantyEnd
  );
  if (!isEditing && !hasPurchase) return null;

  return (
    <Section icon={Receipt} title="Provenance">
      <DetailField
        label="Purchased"
        icon={Calendar}
        value={purchase.date}
        editing={isEditing}
        mono
        input={<DateInput value={purchase.date} onChange={(v) => setPurchase({ date: v })} />}
      />
      <DetailField
        label="Vendor"
        icon={Briefcase}
        value={purchase.vendor}
        editing={isEditing}
        input={
          <TextInput
            value={purchase.vendor}
            onChange={(v) => setPurchase({ vendor: v })}
            placeholder="Where you bought it"
          />
        }
      />
      <DetailField
        label="Price"
        icon={Tag}
        value={purchase.price}
        editing={isEditing}
        mono
        input={
          <TextInput
            value={purchase.price}
            onChange={(v) => setPurchase({ price: v })}
            placeholder="$0.00"
            mono
          />
        }
      />
      <DetailField
        label="Receipt #"
        icon={Hash}
        value={purchase.receiptRef}
        editing={isEditing}
        mono
        input={
          <TextInput
            value={purchase.receiptRef}
            onChange={(v) => setPurchase({ receiptRef: v })}
            placeholder="Order or receipt reference"
            mono
          />
        }
      />
      <DetailField
        label="Warranty"
        icon={ShieldCheck}
        value={purchase.warrantyEnd}
        editing={isEditing}
        mono
        input={
          <DateInput
            value={purchase.warrantyEnd}
            onChange={(v) => setPurchase({ warrantyEnd: v })}
            hint={warrantyHint(purchase.warrantyEnd)}
          />
        }
      />
    </Section>
  );
}
