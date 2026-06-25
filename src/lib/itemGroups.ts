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
  // Cafetería / gastronomía: prepared food & drinks served at a café or resto.
  // Coarser than a grocery rubro on purpose — the price comparison in /cafes
  // works at the product-name level, these just keep the rubros tidy.
  'café',
  'tostados y sándwiches',
  'pastelería',
  'desayuno y bowls',
  'jugos y licuados',
  'otros',
] as const;

export type ItemGroup = (typeof ITEM_GROUPS)[number];

export const ITEM_GROUP_META: Record<string, { icon: string; color: string }> = {
  'frutas y verduras': { icon: '🥬', color: '#2FA37C' },
  'carnes y fiambres': { icon: '🥩', color: '#FF6F61' },
  'lácteos y huevos': { icon: '🥚', color: '#F2C94C' },
  almacén: { icon: '🫙', color: '#B5926B' },
  panadería: { icon: '🥖', color: '#D9A05B' },
  agua: { icon: '💧', color: '#5BC4D6' },
  bebidas: { icon: '🥤', color: '#7AA6E6' },
  snacks: { icon: '🍫', color: '#F5A623' },
  limpieza: { icon: '🧼', color: '#5C9CE6' },
  'cuidado personal': { icon: '🧴', color: '#E89AC7' },
  hogar: { icon: '🏠', color: '#B084CC' },
  mascotas: { icon: '🐾', color: '#A0855B' },
  café: { icon: '☕', color: '#6F4E37' },
  'tostados y sándwiches': { icon: '🥪', color: '#E0A458' },
  pastelería: { icon: '🍰', color: '#E8A6C8' },
  'desayuno y bowls': { icon: '🥣', color: '#3FAE8F' },
  'jugos y licuados': { icon: '🧃', color: '#F39B2D' },
  otros: { icon: '🏷️', color: '#B0BAB4' },
};

// The cafetería/gastronomía subset of the taxonomy — used by the receipt parser
// to classify café-ticket items and by /cafes to know which rubros are "café".
export const CAFE_ITEM_GROUPS: readonly string[] = [
  'café',
  'tostados y sándwiches',
  'pastelería',
  'desayuno y bowls',
  'jugos y licuados',
];

export function groupMeta(group: string): { icon: string; color: string } {
  return ITEM_GROUP_META[group] ?? ITEM_GROUP_META.otros;
}
