// Design tokens — single source of truth. Never use raw hex outside this file.
export const tokens = {
  sage: '#7EC8A4',
  sageSoft: '#E4F2EA',
  sageDeep: '#5BA886',
  cream: '#F9F5F0',
  coral: '#FF7F6B',
  coralSoft: '#FFE7E2',
  coralDeep: '#E5604C',
  charcoal: '#2D2D2D',
  surface: '#FFFFFF',
  muted: '#6B6459',
  hairline: '#ECE5DC',
} as const;

export type TokenKey = keyof typeof tokens;
