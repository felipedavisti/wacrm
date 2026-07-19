// Friendly display name for a WhatsApp number (spec 007, Estágio C).
// A number reads the same everywhere — the Settings list, the inbox
// indicator, and the broadcast/cold-outreach pickers — by running through
// this single fallback chain:
//
//   label (user's freeform tag) → verified_name (Meta business name) →
//   display_phone_number ("+55 71 …") → phone_number_id (raw Meta id).
//
// `phone_info` (the live verifyPhoneNumber result) is accepted as a
// secondary source so a caller that only has the live health payload —
// not the stored columns — still resolves a friendly name.
export type NumberNameParts = {
  label?: string | null;
  verified_name?: string | null;
  display_phone_number?: string | null;
  phone_number_id: string;
  phone_info?: { verified_name?: string; display_phone_number?: string };
};

export function numberDisplayName(c: NumberNameParts): string {
  return (
    c.label ||
    c.verified_name ||
    c.phone_info?.verified_name ||
    c.display_phone_number ||
    c.phone_info?.display_phone_number ||
    c.phone_number_id
  );
}
