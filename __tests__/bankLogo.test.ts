import { describe, it, expect } from '@jest/globals';
import { BANK_DICTIONARY } from '../src/constants/Constants';
import { BANK_LOGOS } from '../src/components/BankLogo';

describe('Bank Logos Mapping', () => {
  it('should have an official logo asset for every bank key defined in BANK_DICTIONARY', () => {
    const bankKeys = Object.keys(BANK_DICTIONARY);
    expect(bankKeys.length).toBeGreaterThanOrEqual(35);

    for (const key of bankKeys) {
      expect(BANK_LOGOS[key]).toBeDefined();
      expect(BANK_LOGOS[key]).not.toBeNull();
    }
  });

  it('should provide fallback logo for unknown bank keys', () => {
    expect(BANK_LOGOS.OT).toBeDefined();
  });
});
