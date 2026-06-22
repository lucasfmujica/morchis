import { describe, it, expect } from 'vitest';
import { niceRound, buildSuggestions, fmt, type Cat } from './math.ts';

describe('niceRound', () => {
  it('returns 0 for non-positive input', () => {
    expect(niceRound(0)).toBe(0);
    expect(niceRound(-5)).toBe(0);
  });
  it('rounds up to 5k steps under 50k', () => {
    expect(niceRound(12000)).toBe(15000);
    expect(niceRound(15000)).toBe(15000);
  });
  it('rounds up to 10k steps between 50k and 200k', () => {
    expect(niceRound(123000)).toBe(130000);
  });
  it('rounds up to 25k steps at/above 200k', () => {
    expect(niceRound(210000)).toBe(225000);
  });
});

describe('buildSuggestions', () => {
  const cats: Cat[] = [
    { id: 'a', name: 'Súper' },
    { id: 'b', name: 'Delivery' },
    { id: 'c', name: 'YaPresupuestada' },
    { id: 'd', name: 'Insignificante' },
  ];
  it('skips budgeted categories and sub-threshold figures, sorts desc, caps at 8', () => {
    const budgeted = new Set(['c']);
    const hist3 = { a: 300000, b: 60000, d: 3000 }; // /3 → 100k, 20k, 1k
    const last1 = { a: 90000, b: 50000 };
    const cur0 = {};
    const res = buildSuggestions(cats, budgeted, hist3, last1, cur0, 15, 30);
    // 'c' excluded (budgeted), 'd' excluded (suggested < 10000)
    expect(res.map(s => s.name)).toEqual(['Súper', 'Delivery']);
    // Súper base = max(100k avg, 90k last, 0 proj) = 100k → niceRound 100k
    expect(res[0].suggested).toBe(100000);
    // Delivery base = max(20k, 50k, 0) = 50k → niceRound(50000) = 50000
    expect(res[1].suggested).toBe(50000);
  });
  it('projects the current month to full-month pace', () => {
    const res = buildSuggestions([{ id: 'a', name: 'Súper' }], new Set(), {}, {}, { a: 50000 }, 10, 30);
    // projected = 50000/10*30 = 150000 → niceRound(150000) = 150000
    expect(res[0].projected).toBe(150000);
    expect(res[0].suggested).toBe(150000);
  });
});

describe('fmt', () => {
  it('formats ARS', () => {
    expect(fmt(1234567)).toContain('1.234.567');
  });
});
