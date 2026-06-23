// Accent-insensitive matching: NFD + strip combining marks + lowercase, so
// "cafe" finds "Café" and "Martinez" finds "Martínez".
export function normalizeText(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Stronger normalization for merchant names / labels: also drops every
// non-alphanumeric char, so "Café Martínez" ≈ "CAFE-MARTINEZ" ≈ "cafe martinez".
// Used to group the same payee written slightly differently.
export function normalizeMerchant(s: string): string {
  return normalizeText(s).replace(/[^a-z0-9]/g, '');
}
