import { describe, it, expect } from '@jest/globals';
import {
  isValidLuhn,
  extractCardNumber,
  extractExpiry,
  extractBankName,
  extractNetwork,
  extractCardType,
  extractCardholderName,
  extractCvv,
  parseCardOCR,
} from '../src/util/CardParser';

describe('CardParser tests', () => {
  describe('isValidLuhn', () => {
    it('validates a known valid Visa card number', () => {
      // 4532 0150 1234 5671 (valid Luhn)
      expect(isValidLuhn('4532015012345671')).toBe(true);
    });

    it('rejects an invalid card number with wrong checksum', () => {
      expect(isValidLuhn('4532015012345678')).toBe(false);
    });

    it('rejects numbers that are too short or too long', () => {
      expect(isValidLuhn('12345')).toBe(false);
      expect(isValidLuhn('123456789012345678901')).toBe(false);
    });
  });

  describe('extractCardNumber', () => {
    it('extracts formatted 16-digit card number with spaces', () => {
      const line = '4532 0150 1234 5671';
      const extracted = extractCardNumber(line);
      expect(extracted).toBe('4532 0150 1234 5671');
    });

    it('extracts continuous card number that satisfies Luhn', () => {
      const line = 'Card No: 4532015012345671 Valid';
      const extracted = extractCardNumber(line);
      expect(extracted).toBe('4532 0150 1234 5671');
    });

    it('extracts vertically printed card number where 4-digit groups are stacked across lines', () => {
      const lines = [
        'ONECARD',
        '4532',
        '0150',
        '1234',
        '5671',
        'EXP 09/28',
      ];
      const extracted = extractCardNumber(lines.join('\n'), lines);
      expect(extracted).toBe('4532 0150 1234 5671');
    });

    it('repairs OCR misreads like O or l in card numbers', () => {
      const line = '4532 O15O l234 5671';
      const extracted = extractCardNumber(line);
      expect(extracted).toBe('4532 0150 1234 5671');
    });

    it('ignores invalid digit sequences like phone numbers or dates', () => {
      expect(extractCardNumber('+91 98765 43210')).toBeUndefined();
      expect(extractCardNumber('12/2026')).toBeUndefined();
    });
  });

  describe('extractExpiry', () => {
    it('extracts MM/YY format with VALID THRU prefix', () => {
      const res = extractExpiry('VALID THRU 08/28');
      expect(res).toEqual({ month: '08', year: '28' });
    });

    it('extracts standalone MM/YY', () => {
      const res = extractExpiry('11/29');
      expect(res).toEqual({ month: '11', year: '29' });
    });

    it('handles spaces around slash', () => {
      const res = extractExpiry('GOOD THRU 05 / 27');
      expect(res).toEqual({ month: '05', year: '27' });
    });

    it('extracts multi-line expiry where EXP is on previous line', () => {
      const lines = ['ONECARD', 'EXPIRY DATE', '08/29'];
      const res = extractExpiry(lines.join('\n'), lines);
      expect(res).toEqual({ month: '08', year: '29' });
    });

    it('fixes OCR O in month like O8/28', () => {
      const res = extractExpiry('VALID THRU O8/28');
      expect(res).toEqual({ month: '08', year: '28' });
    });

    it('ignores invalid months like 15/28', () => {
      expect(extractExpiry('15/28')).toBeUndefined();
    });
  });

  describe('extractBankName', () => {
    it('identifies HDFC bank', () => {
      expect(extractBankName('HDFC BANK MILLENNIA')).toBe('HD');
    });

    it('identifies ICICI bank', () => {
      expect(extractBankName('ICICI Bank Coral')).toBe('IC');
    });

    it('identifies SBI bank', () => {
      expect(extractBankName('STATE BANK OF INDIA')).toBe('SB');
    });

    it('identifies Axis bank', () => {
      expect(extractBankName('AXIS BANK NEO')).toBe('AX');
    });
  });

  describe('extractNetwork', () => {
    it('identifies Visa from text', () => {
      expect(extractNetwork('VISA PLATINUM')).toBe('VISA');
    });

    it('identifies Mastercard from text', () => {
      expect(extractNetwork('MASTERCARD WORLD')).toBe('MASTERCARD');
    });

    it('identifies RuPay from text', () => {
      expect(extractNetwork('RuPay Select Debit')).toBe('RUPAY');
    });

    it('identifies network from PAN if text is not explicit', () => {
      expect(extractNetwork('', '4532015012345677')).toBe('VISA');
    });
  });

  describe('extractCardType', () => {
    it('identifies DEBIT card', () => {
      expect(extractCardType('GLOBAL DEBIT CARD')).toBe('DEBIT');
    });

    it('identifies CREDIT card', () => {
      expect(extractCardType('SIGNATURE CREDIT CARD')).toBe('CREDIT');
    });
  });

  describe('extractCardholderName', () => {
    it('extracts clean cardholder name in title case', () => {
      const lines = [
        'HDFC BANK',
        '4532 0150 1234 5677',
        'VALID THRU 08/28',
        'YASH MEHTA',
        'VISA PLATINUM',
      ];
      expect(extractCardholderName(lines, '4532 0150 1234 5677', 'HD')).toBe('Yash Mehta');
    });

    it('extracts 3-word name with middle initial', () => {
      const lines = [
        'ICICI BANK',
        '4532 0150 1234 5677',
        'RAHUL S SHARMA',
      ];
      expect(extractCardholderName(lines, '4532 0150 1234 5677', 'IC')).toBe('Rahul S Sharma');
    });

    it('ignores card keywords, tiers, and bank names', () => {
      const lines = [
        'STATE BANK OF INDIA',
        'DEBIT CARD',
        'VALID THRU 10/27',
        'PLATINUM REWARDS',
        'INFINITE PRIVILEGE',
      ];
      expect(extractCardholderName(lines, undefined, 'SB')).toBeUndefined();
    });

    it('rejects disclaimers and back-of-card text', () => {
      const lines = [
        'AUTHORIZED SIGNATURE',
        'NOT VALID UNLESS SIGNED',
        'FOR DOMESTIC USE ONLY',
        'PLEASE RETURN TO NEAREST BRANCH',
        'CUSTOMER CARE 1800',
      ];
      expect(extractCardholderName(lines)).toBeUndefined();
    });

    it('rejects co-branded partner labels', () => {
      const lines = [
        'FLIPKART AXIS BANK',
        'AMAZON PAY ICICI',
        'TATANEU PLUS',
      ];
      expect(extractCardholderName(lines)).toBeUndefined();
    });
  });

  describe('extractCvv', () => {
    it('extracts labeled 3-digit CVV', () => {
      expect(extractCvv('CVV 456', ['CVV 456'])).toBe('456');
      expect(extractCvv('CVC: 789', ['CVC: 789'])).toBe('789');
      expect(extractCvv('CID: 1234', ['CID: 1234'])).toBe('1234');
      expect(extractCvv('SECURITY CODE 321', ['SECURITY CODE 321'])).toBe('321');
    });

    it('extracts CVV on the line following label', () => {
      const lines = ['Authorized Signature', 'CVV', '789'];
      expect(extractCvv(lines.join('\n'), lines)).toBe('789');
    });

    it('extracts 3-digit CVV following last 4 digits on signature strip', () => {
      const lines = ['5671 456'];
      expect(extractCvv(lines.join('\n'), lines, '4532 0150 1234 5671')).toBe('456');
    });

    it('extracts standalone 3-digit CVV on back of card', () => {
      const lines = [
        'Authorized Signature',
        'Not valid unless signed',
        '789',
      ];
      expect(extractCvv(lines.join('\n'), lines, '4532 0150 1234 5671')).toBe('789');
    });

    it('rejects digits that belong to the card number or all-same digits', () => {
      const lines = ['000'];
      expect(extractCvv(lines.join('\n'), lines)).toBeUndefined();

      // '567' is a 3-digit substring of '4532 0150 1234 5671'
      const linesWithCardSub = ['567'];
      expect(extractCvv(linesWithCardSub.join('\n'), linesWithCardSub, '4532 0150 1234 5671')).toBeUndefined();
    });
  });

  describe('parseCardOCR full integration', () => {
    it('parses realistic live card OCR output into structured form data', () => {
      const lines = [
        'ICICI BANK',
        'SAPPHIRO',
        '4532 0150 1234 5671',
        'VALID THRU 12/28',
        'RAHUL S SHARMA',
        'VISA SIGNATURE',
        'CREDIT',
      ];

      const result = parseCardOCR(lines);
      expect(result.bankName).toBe('IC');
      expect(result.cardNumber).toBe('4532 0150 1234 5671');
      expect(result.month).toBe('12');
      expect(result.year).toBe('28');
      expect(result.ownerName).toBe('Rahul S Sharma');
      expect(result.network).toBe('VISA');
      expect(result.cardType).toBe('CREDIT');
    });

    it('parses realistic vertically printed card OCR data', () => {
      const verticalLines = [
        'ONECARD',
        '4532',
        '0150',
        '1234',
        '5671',
        'EXP',
        '10/28',
        'PRIYA NAIR',
        'VISA SIGNATURE',
      ];

      const result = parseCardOCR(verticalLines);
      expect(result.bankName).toBe('BB'); // OneCard issued via Bank of Baroda / Federal
      expect(result.cardNumber).toBe('4532 0150 1234 5671');
      expect(result.month).toBe('10');
      expect(result.year).toBe('28');
      expect(result.ownerName).toBe('Priya Nair');
      expect(result.network).toBe('VISA');
    });

    it('extracts CVV/CVC when printed or requested', () => {
      const lines = [
        'HDFC BANK',
        '4532 0150 1234 5671',
        'CVV 892',
        '08/28',
      ];
      const result = parseCardOCR(lines);
      expect(result.cvv).toBe('892');
    });
  });
});
