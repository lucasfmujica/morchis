// YNAB-style colour flags for transactions. Stored as the `key` in
// transactions.flag; rendered with `hex`.
export const FLAG_COLORS: { key: string; hex: string; label: string }[] = [
  { key: 'red', hex: '#E5604C', label: 'Rojo' },
  { key: 'orange', hex: '#F5A623', label: 'Naranja' },
  { key: 'yellow', hex: '#E8C84A', label: 'Amarillo' },
  { key: 'green', hex: '#5BA886', label: 'Verde' },
  { key: 'blue', hex: '#5B8DEF', label: 'Azul' },
  { key: 'purple', hex: '#B084CC', label: 'Violeta' },
];

export const flagHex = (key: string | null | undefined): string | null =>
  FLAG_COLORS.find((f) => f.key === key)?.hex ?? null;
