// Design tokens — single source of truth. Never use raw hex outside this file.
export const tokens = {
  sage: '#2FA37C',
  sageSoft: '#DDF0E8',
  sageDeep: '#1F8A68',
  cream: '#F1F5F3',
  coral: '#FF6F61',
  coralSoft: '#FFE5E0',
  coralDeep: '#E25749',
  charcoal: '#18211D',
  surface: '#FFFFFF',
  muted: '#5B6660',
  hairline: '#E5EBE8',
} as const;

export type TokenKey = keyof typeof tokens;
