import { describe, it, expect } from '@jest/globals';
import { formatBillGenerationDate, formatCardUpdatedDate } from '../src/util/Utils';

describe('formatBillGenerationDate', () => {
  it('formats standard day numbers with proper English ordinal suffixes', () => {
    expect(formatBillGenerationDate('1')).toBe('1st');
    expect(formatBillGenerationDate('2')).toBe('2nd');
    expect(formatBillGenerationDate('3')).toBe('3rd');
    expect(formatBillGenerationDate('4')).toBe('4th');
    expect(formatBillGenerationDate('11')).toBe('11th');
    expect(formatBillGenerationDate('12')).toBe('12th');
    expect(formatBillGenerationDate('13')).toBe('13th');
    expect(formatBillGenerationDate('15')).toBe('15th');
    expect(formatBillGenerationDate('21')).toBe('21st');
    expect(formatBillGenerationDate('22')).toBe('22nd');
    expect(formatBillGenerationDate('23')).toBe('23rd');
    expect(formatBillGenerationDate('31')).toBe('31st');
  });

  it('handles numeric numbers as well as string numbers', () => {
    expect(formatBillGenerationDate(15)).toBe('15th');
    expect(formatBillGenerationDate(1)).toBe('1st');
  });

  it('returns empty string for undefined, null, or empty values', () => {
    expect(formatBillGenerationDate('')).toBe('');
    expect(formatBillGenerationDate(undefined)).toBe('');
  });

  it('preserves existing custom text like "15th"', () => {
    expect(formatBillGenerationDate('15th')).toBe('15th');
  });
});

describe('formatCardUpdatedDate', () => {
  it('formats millisecond timestamps into short date string', () => {
    const fixedTime = new Date('2026-11-19T10:00:00Z').getTime();
    const formatted = formatCardUpdatedDate(fixedTime);
    expect(formatted).toContain('Nov');
  });

  it('formats Firestore-style timestamp objects with seconds', () => {
    const ts = { seconds: Math.floor(new Date('2026-05-15T12:00:00Z').getTime() / 1000) };
    const formatted = formatCardUpdatedDate(ts);
    expect(formatted).toContain('15 May');
  });

  it('returns empty string for missing or 0 timestamps', () => {
    expect(formatCardUpdatedDate(undefined)).toBe('');
    expect(formatCardUpdatedDate(0)).toBe('');
    expect(formatCardUpdatedDate(null)).toBe('');
  });
});

