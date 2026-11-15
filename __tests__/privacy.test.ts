import { describe, it, expect } from '@jest/globals';
import { maskCardNumber } from '../src/util/Utils';

describe('Privacy Mode - maskCardNumber', () => {
  it('masks standard 16-digit card keeping only last 4 digits', () => {
    expect(maskCardNumber('4111 2222 3333 4444')).toBe('•••• •••• •••• 4444');
    expect(maskCardNumber('4111222233334444')).toBe('•••• •••• •••• 4444');
  });

  it('masks 15-digit Amex card keeping only last 4 digits', () => {
    expect(maskCardNumber('3782 822463 10005')).toBe('•••• •••••• •0005');
    expect(maskCardNumber('378282246310005')).toBe('•••• •••••• •0005');
  });

  it('masks 14-digit Diners Club card keeping only last 4 digits', () => {
    expect(maskCardNumber('3056 930902 5467')).toBe('•••• •••••• 5467');
    expect(maskCardNumber('30569309025467')).toBe('•••• •••••• 5467');
  });

  it('handles empty or short input gracefully', () => {
    expect(maskCardNumber('')).toBe('••••');
    expect(maskCardNumber('1234')).toBe('1234');
    expect(maskCardNumber('12')).toBe('12');
  });
});

