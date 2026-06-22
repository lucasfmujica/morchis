import { describe, it, expect } from 'vitest';
import { isoOf, fmtARS, nextOccurrence, prevOccurrence, daysBetween } from './math.ts';

describe('nextOccurrence', () => {
  it('returns the same-month day when it is still ahead', () => {
    expect(nextOccurrence('2026-01-20', '2026-06-05')).toBe('2026-06-20');
  });
  it('rolls to next month once the day has passed', () => {
    expect(nextOccurrence('2026-01-10', '2026-06-15')).toBe('2026-07-10');
  });
  it('clamps a day-31 anchor to the month length (Feb)', () => {
    expect(nextOccurrence('2026-01-31', '2026-02-01')).toBe('2026-02-28');
  });
  it('returns today when the anchor day equals today', () => {
    expect(nextOccurrence('2026-01-15', '2026-06-15')).toBe('2026-06-15');
  });
});

describe('prevOccurrence', () => {
  it('finds the occurrence one month before the next one', () => {
    // next from 2026-06-15 for anchor day 20 is 2026-06-20 → prev is 2026-05-20
    expect(prevOccurrence('2026-01-20', '2026-06-15')).toBe('2026-05-20');
  });
  it('clamps when the previous month is shorter', () => {
    // next for day-31 from 2026-03-01 is 2026-03-31 → prev month Feb clamps to 28
    expect(prevOccurrence('2026-01-31', '2026-03-01')).toBe('2026-02-28');
  });
});

describe('daysBetween', () => {
  it('counts whole days between ISO dates', () => {
    expect(daysBetween('2026-06-01', '2026-06-04')).toBe(3);
    expect(daysBetween('2026-06-04', '2026-06-01')).toBe(-3);
  });
});

describe('isoOf / fmtARS', () => {
  it('isoOf formats a Date to YYYY-MM-DD', () => {
    expect(isoOf(new Date(Date.UTC(2026, 5, 22)))).toBe('2026-06-22');
  });
  it('fmtARS formats pesos with thousands separators', () => {
    expect(fmtARS(1234567)).toContain('1.234.567');
  });
});
