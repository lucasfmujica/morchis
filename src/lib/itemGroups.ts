// Product groups for scanned-receipt line items (transaction_items.item_group).
// Shared by the ticket scanner (/ticket), the per-purchase detail sheet and the
// dedicated grocery view (/super) so the labels, icons and colours stay in sync.

export const ITEM_GROUPS = [
  'frutas y verduras',
  'carnes y fiambres',
  'lácteos y huevos',
  'almacén',
  'panadería',
  'agua',
  'bebidas',
  'snacks',
  'limpieza',
  'cuidado personal',
  'hogar',
  'mascotas',
  'otros',
] as const;

export type ItemGroup = (typeof ITEM_GROUPS)[number];

export const ITEM_GROUP_META: Record<string, { icon: string; color: string }> = {
  'frutas y verduras': { icon: '🥬', color: '#7EC8A4' },
  'carnes y fiambres': { icon: '🥩', color: '#E8806B' },
  'lácteos y huevos': { icon: '🥚', color: '#F2C94C' },
  almacén: { icon: '🫙', color: '#B5926B' },
  panadería: { icon: '🥖', color: '#D9A05B' },
  agua: { icon: '💧', color: '#5BC4D6' },
  bebidas: { icon: '🥤', color: '#6FA8DC' },
  snacks: { icon: '🍫', color: '#F5A623' },
  limpieza: { icon: '🧼', color: '#5C9CE6' },
  'cuidado personal': { icon: '🧴', color: '#E89AC7' },
  hogar: { icon: '🏠', color: '#B084CC' },
  mascotas: { icon: '🐾', color: '#A0855B' },
  otros: { icon: '🏷️', color: '#C4B9AE' },
};

export function groupMeta(group: string): { icon: string; color: string } {
  return ITEM_GROUP_META[group] ?? ITEM_GROUP_META.otros;
}
