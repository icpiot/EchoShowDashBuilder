export type HolderCard = { config: Record<string, any>; view_path: string; position: number };

export type EchoCardLibraryEntry = {
  id: string;
  name: string;
  fingerprint: string;
  source_dashboard: string;
  source_view: string;
  source_position: number;
  card_type: string;
  missing?: boolean;
};

function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.keys(value).sort().reduce((next: any, key) => {
    next[key] = canonical(value[key]);
    return next;
  }, {});
  return value;
}

/** A stable content fingerprint. It identifies unchanged ordinary Lovelace cards without writing metadata into them. */
export function cardFingerprint(config: Record<string, any>): string {
  const text = JSON.stringify(canonical(config));
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16)}`;
}

export function suggestedCardName(config: Record<string, any>, fallback: string): string {
  return String(config.name || config.title || config.label || config.entity || fallback);
}

export function reconcileCardLibrary(
  existing: EchoCardLibraryEntry[],
  cards: HolderCard[],
  sourceDashboard: string,
  makeId: () => string,
): EchoCardLibraryEntry[] {
  const available: EchoCardLibraryEntry[] = existing.map((entry) => ({ ...entry, missing: true }));
  const used = new Set<string>();
  for (const card of cards) {
    const fingerprint = cardFingerprint(card.config);
    // A content match keeps the identity through movement. Only an unchanged
    // card is eligible, so a removed card can never be silently reassigned.
    const match = available.find((entry) => !used.has(entry.id) && entry.fingerprint === fingerprint);
    const entry: EchoCardLibraryEntry = match || {
      id: makeId(),
      name: suggestedCardName(card.config, `Card ${card.position + 1}`),
      fingerprint,
      source_dashboard: sourceDashboard,
      source_view: card.view_path,
      source_position: card.position,
      card_type: String(card.config.type || "unknown"),
      missing: false,
    };
    used.add(entry.id);
    Object.assign(entry, {
      fingerprint,
      source_dashboard: sourceDashboard,
      source_view: card.view_path,
      source_position: card.position,
      card_type: String(card.config.type || "unknown"),
      missing: false,
    });
    const index = available.findIndex((item) => item.id === entry.id);
    if (index >= 0) available[index] = entry;
    else available.push(entry);
  }
  return available;
}
