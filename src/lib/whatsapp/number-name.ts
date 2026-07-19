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

// Map waba_id → friendly number name, for labelling/grouping templates by
// the number/App they belong to (spec 007). A WABA can carry more than one
// number, so names are joined. Used by the template manager and the
// broadcast template step so a template shows which number it's for.
export function wabaLabelMap(
  configs: (NumberNameParts & { waba_id?: string | null })[],
): Map<string, string> {
  const m = new Map<string, string>();
  for (const c of configs) {
    if (!c.waba_id) continue;
    const name = numberDisplayName(c);
    const prev = m.get(c.waba_id);
    m.set(c.waba_id, prev ? `${prev}, ${name}` : name);
  }
  return m;
}

// The label to show for a template's waba_id: the friendly number name if
// known, a short WABA tag when the WABA isn't one of the account's numbers,
// or null for a template with no WABA (legacy/global → caller decides copy).
export function templateWabaLabel(
  wabaId: string | null | undefined,
  map: Map<string, string>,
): string | null {
  if (!wabaId) return null;
  return map.get(wabaId) ?? `WABA ${wabaId.slice(-4)}`;
}
