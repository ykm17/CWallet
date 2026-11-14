import { BANK_DICTIONARY } from '../constants/Constants';
import { detectCardNetwork, formatCardNumber } from './Utils';

export interface ParsedCardData {
  cardNumber?: string;
  month?: string;
  year?: string;
  ownerName?: string;
  bankName?: string;
  network?: string;
  cardType?: string;
  cvv?: string;
}

/**
 * Standard Luhn Checksum Algorithm (Mod 10) to validate payment card numbers.
 */
export const isValidLuhn = (cardNumber: string): boolean => {
  const digits = cardNumber.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;

  let sum = 0;
  let shouldDouble = false;

  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = parseInt(digits.charAt(i), 10);
    if (isNaN(digit)) return false;

    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }

    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum % 10 === 0;
};

/**
 * Repairs common OCR misread characters for digit sequences.
 * (e.g. O/D/Q -> 0, I/l/| -> 1, Z -> 2, S -> 5, G -> 6, B -> 8)
 */
export const cleanOcrDigits = (text: string): string => {
  return text
    .replace(/[OoQqDd]/g, '0')
    .replace(/[Il|!\]\[]/g, '1')
    .replace(/[Zz]/g, '2')
    .replace(/[Ss$]/g, '5')
    .replace(/[Gg]/g, '6')
    .replace(/[Bb]/g, '8')
    .replace(/[Tt]/g, '7');
};

// Bank name mapping keywords to BANK_DICTIONARY keys (including modern vertical card brands)
const BANK_KEYWORD_MAP: Array<{ keywords: string[]; bankKey: string }> = [
  { keywords: ['HDFC', 'HDFC BANK'], bankKey: 'HD' },
  { keywords: ['ICICI', 'ICICI BANK'], bankKey: 'IC' },
  { keywords: ['AXIS', 'AXIS BANK'], bankKey: 'AX' },
  { keywords: ['SBI', 'STATE BANK OF INDIA', 'STATE BANK'], bankKey: 'SB' },
  { keywords: ['KOTAK', 'KOTAK MAHINDRA', 'KOTAK BANK'], bankKey: 'KT' },
  { keywords: ['IDFC', 'IDFC FIRST'], bankKey: 'ID' },
  { keywords: ['AMERICAN EXPRESS', 'AMEX'], bankKey: 'AM' },
  { keywords: ['CITI', 'CITIBANK'], bankKey: 'CT' },
  { keywords: ['RBL', 'RBL BANK', 'RATNAKAR'], bankKey: 'RL' },
  { keywords: ['BANK OF BARODA', 'BOB', 'ONECARD', 'ONE CARD'], bankKey: 'BB' },
  { keywords: ['AU SMALL FINANCE', 'AU BANK', 'AU SMALL'], bankKey: 'AU' },
  { keywords: ['PUNJAB NATIONAL', 'PNB'], bankKey: 'PN' },
  { keywords: ['CANARA', 'CANARA BANK'], bankKey: 'CN' },
  { keywords: ['UNION BANK', 'UNION BANK OF INDIA'], bankKey: 'UN' },
  { keywords: ['YES BANK', 'YES'], bankKey: 'YS' },
  { keywords: ['STANDARD CHARTERED', 'STAN CHART'], bankKey: 'SC' },
  { keywords: ['DBS', 'DBS BANK'], bankKey: 'DB' },
  { keywords: ['FEDERAL BANK', 'FEDERAL', 'SCAPIA', 'FI MONEY', 'FI', 'JUPITER', 'NIYO'], bankKey: 'FD' },
  { keywords: ['HSBC'], bankKey: 'HS' },
  { keywords: ['INDUSIND', 'INDUSIND BANK'], bankKey: 'IN' },
  { keywords: ['DINERS CLUB', 'DINERS'], bankKey: 'DC' },
  { keywords: ['SARASWAT', 'SARASWAT BANK'], bankKey: 'SW' },
  { keywords: ['BANK OF INDIA', 'BOI'], bankKey: 'BO' },
  { keywords: ['INDIAN BANK'], bankKey: 'IB' },
  { keywords: ['CENTRAL BANK OF INDIA', 'CENTRAL BANK'], bankKey: 'CB' },
  { keywords: ['IDBI', 'IDBI BANK'], bankKey: 'IDB' },
  { keywords: ['BANDHAN', 'BANDHAN BANK'], bankKey: 'BD' },
  { keywords: ['KARUR VYSYA', 'KVB'], bankKey: 'KV' },
  { keywords: ['SOUTH INDIAN BANK', 'SIB'], bankKey: 'SI' },
  { keywords: ['UCO BANK', 'UCO'], bankKey: 'UB' },
  { keywords: ['INDIAN OVERSEAS', 'IOB'], bankKey: 'IO' },
  { keywords: ['PUNJAB & SIND', 'PUNJAB AND SIND'], bankKey: 'PS' },
  { keywords: ['JAMMU & KASHMIR', 'J&K BANK', 'JK BANK'], bankKey: 'JK' },
];

// Words to exclude when extracting cardholder name (banking terms, tiers, brands, disclaimers, grammatical fillers)
const NAME_EXCLUSIONS = new Set([
  // Dates, Validity, CVV
  'VALID', 'THRU', 'GOOD', 'EXPIRES', 'EXP', 'DATE', 'FROM', 'MONTH', 'YEAR', 'VAL', 'CVV', 'CVC', 'CID',
  // Card Types & Banking
  'DEBIT', 'CREDIT', 'CARD', 'CARDS', 'PREPAID', 'FOREX', 'ATM', 'CHIP', 'SMART', 'ELECTRON', 'ELECTRONIC',
  'BANK', 'BANKING', 'FINANCE', 'FINANCIAL', 'FIN', 'CUSTOMER', 'CARE', 'HELPLINE', 'HELP', 'SUPPORT',
  'ACCOUNT', 'SERVICE', 'SERVICES', 'BRANCH', 'OFFICE', 'INDIA',
  // Tiers & Variants
  'BUSINESS', 'CORPORATE', 'COMMERCIAL', 'ENTERPRISE', 'PLATINUM', 'GOLD', 'SILVER', 'TITANIUM', 'DIAMOND',
  'SIGNATURE', 'INFINITE', 'WORLD', 'ELITE', 'CLASSIC', 'PREMIER', 'PREMIUM', 'PRIVILEGE', 'SELECT',
  'PREFERRED', 'PLUS', 'PRIME', 'PRO', 'ZERO', 'FIRST', 'METAL', 'BLACK', 'WHITE', 'EXCLUSIVE',
  'REWARDS', 'REWARD', 'POINTS', 'POINT', 'CASHBACK', 'CLUB', 'MILES',
  // Brand / Products
  'MILLENNIA', 'REGALIA', 'INVENTIA', 'SAPPHIRO', 'RUBYX', 'CORAL', 'EMERALD', 'MAGNUS', 'BURGUNDY',
  'ATLAS', 'APEX', 'NEO', 'ZONE', 'ONE', 'ONECARD', 'SCAPIA', 'FI', 'JUPITER', 'NIYO', 'SLICE', 'POSTPE', 'LAZYPAY',
  // Networks
  'VISA', 'MASTERCARD', 'RUPAY', 'AMEX', 'AMERICAN', 'EXPRESS', 'DINERS', 'DISCOVER', 'JCB', 'MAESTRO', 'CIRRUS',
  // Disclaimers & Text on Back
  'AUTHORIZED', 'SIGNATURE', 'NOT', 'WITHOUT', 'SIGNED', 'SIGN', 'HOLDER', 'PROPERTY', 'ISSUED', 'RETURN',
  'FOUND', 'PLEASE', 'NEAREST', 'TERMS', 'CONDITIONS', 'APPLY', 'MEMBER', 'SINCE', 'CONTACTLESS',
  'DOMESTIC', 'INTERNATIONAL', 'GLOBAL', 'NATIONAL', 'CENTRAL', 'STATE', 'ONLY', 'USE', 'FOR',
  'CALL', 'TOLL', 'FREE', 'LOST', 'REPORT', 'SECURITY', 'SECURE', 'CODE',
  // Co-brand partners
  'FLIPKART', 'AMAZON', 'PAYTM', 'SWIGGY', 'ZOMATO', 'MYNTRA', 'TATA', 'TATANEU', 'NEU', 'RELIANCE', 'JIO',
  'AIRTEL', 'VODAFONE', 'INDIANOIL', 'IOCL', 'BPCL', 'HPCL', 'OCTANE', 'VISTARA', 'INDIGO', 'SPICEJET', 'AIRINDIA',
  'MAKEMYTRIP', 'MMT', 'YATRA', 'IRCTC', 'BOOKMYSHOW', 'PAY', 'MONEY', 'WALLET',
  // Grammatical words (never in human names)
  'THE', 'AND', 'OR', 'OF', 'TO', 'IN', 'BY', 'ON', 'WITH', 'AT', 'IS', 'IT', 'BE', 'ARE', 'THIS', 'THAT', 'YOUR', 'OUR', 'ALL', 'ANY', 'IF', 'AS', 'AN'
]);

/**
 * Extracts card numbers from lines or text, supporting both horizontal and vertical cards.
 */
export const extractCardNumber = (text: string, lines?: string[]): string | undefined => {
  const lineArray = lines && lines.length > 0 ? lines : text.split('\n');

  // Strategy 1: Check lines for standard formatted groupings: 4-4-4-4, 4-6-5, 4-6-4
  const spacedMatches = text.match(/\b(?:\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}|\d{4}[ -]?\d{6}[ -]?\d{4,5}|\d{13,19})\b/g);
  if (spacedMatches) {
    for (const match of spacedMatches) {
      const clean = match.replace(/\D/g, '');
      if (isValidLuhn(clean)) {
        return formatCardNumber(clean);
      }
    }
  }

  // Strategy 2: Check lines with OCR digit substitution (e.g. 4532 O15O l234 5671)
  for (const line of lineArray) {
    const repaired = cleanOcrDigits(line);
    const matches = repaired.match(/\b(?:\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}|\d{4}[ -]?\d{6}[ -]?\d{4,5}|\d{13,19})\b/g);
    if (matches) {
      for (const m of matches) {
        const clean = m.replace(/\D/g, '');
        if (isValidLuhn(clean)) {
          return formatCardNumber(clean);
        }
      }
    }
  }

  // Strategy 3: Handle vertically printed cards (where 4-digit groups are stacked across separate lines)
  const fourDigitGroups: string[] = [];
  for (const line of lineArray) {
    const trimmed = cleanOcrDigits(line.trim());
    const digitsOnly = trimmed.replace(/\D/g, '');
    if (digitsOnly.length === 4) {
      fourDigitGroups.push(digitsOnly);
    } else if (digitsOnly.length === 8) {
      fourDigitGroups.push(digitsOnly.slice(0, 4), digitsOnly.slice(4, 8));
    }
  }

  // Look for 4 consecutive 4-digit groups (16-digit card on vertical layout)
  for (let i = 0; i <= fourDigitGroups.length - 4; i++) {
    const candidate = `${fourDigitGroups[i]}${fourDigitGroups[i + 1]}${fourDigitGroups[i + 2]}${fourDigitGroups[i + 3]}`;
    if (isValidLuhn(candidate)) {
      return formatCardNumber(candidate);
    }
  }

  // Strategy 4: Concatenated tokens across all text
  const allDigits = cleanOcrDigits(text).replace(/[^\d\s-]/g, ' ');
  const tokens = allDigits.trim().split(/\s+/).filter(t => t.length > 0);

  // Try combining 4 tokens of 4 digits each
  for (let i = 0; i <= tokens.length - 4; i++) {
    if (
      tokens[i].length === 4 &&
      tokens[i + 1].length === 4 &&
      tokens[i + 2].length === 4 &&
      tokens[i + 3].length === 4
    ) {
      const combined = `${tokens[i]}${tokens[i + 1]}${tokens[i + 2]}${tokens[i + 3]}`;
      if (isValidLuhn(combined)) {
        return formatCardNumber(combined);
      }
    }
  }

  // Try 4-6-5 for Amex
  for (let i = 0; i <= tokens.length - 3; i++) {
    if (tokens[i].length === 4 && tokens[i + 1].length === 6 && tokens[i + 2].length === 5) {
      const combined = `${tokens[i]}${tokens[i + 1]}${tokens[i + 2]}`;
      if (isValidLuhn(combined)) {
        return formatCardNumber(combined);
      }
    }
  }

  return undefined;
};

/**
 * Extracts expiry month and year from lines of text, supporting single-line and multi-line formats.
 */
export const extractExpiry = (text: string, lines?: string[]): { month?: string; year?: string } | undefined => {
  const lineArray = lines && lines.length > 0 ? lines : text.split('\n');

  // Regex for MM/YY or MM/YYYY with various separators (/, -, .) and optional spaces
  const regex = /(?:VALID\s+THRU|GOOD\s+THRU|EXPIRES|EXP|VAL|THRU|MONTH\/YEAR|MM\/YY)?\s*[:\s]?\s*(0[1-9]|1[0-2])\s*[\/\-\.\s]\s*([2-3][0-9])\b/i;

  // Check each line individually
  for (const line of lineArray) {
    const repaired = line.replace(/(\b[Oo])(?=[1-9]\s*[\/\-\.])/g, '0'); // Fix O8/28 -> 08/28
    const match = repaired.match(regex);
    if (match) {
      const month = match[1].padStart(2, '0');
      const year = match[2];
      const mNum = parseInt(month, 10);
      const yNum = parseInt(year, 10);
      if (mNum >= 1 && mNum <= 12 && yNum >= 24 && yNum <= 39) {
        return { month, year };
      }
    }
  }

  // Check multi-line expiry: line i has "EXP" or "VALID THRU", line i+1 has "MM/YY"
  for (let i = 0; i < lineArray.length - 1; i++) {
    const current = lineArray[i].toUpperCase();
    if (/(?:VALID|THRU|EXPIRES|EXP|DATE|MONTH)/.test(current)) {
      const nextLine = lineArray[i + 1].trim();
      const repaired = nextLine.replace(/(\b[Oo])(?=[1-9]\s*[\/\-\.])/g, '0');
      const match = repaired.match(/\b(0[1-9]|1[0-2])\s*[\/\-\.\s]\s*([2-3][0-9])\b/);
      if (match) {
        const month = match[1].padStart(2, '0');
        const year = match[2];
        const mNum = parseInt(month, 10);
        const yNum = parseInt(year, 10);
        if (mNum >= 1 && mNum <= 12 && yNum >= 24 && yNum <= 39) {
          return { month, year };
        }
      }
    }
  }

  // Check full text fallback
  const fullRepaired = text.replace(/(\b[Oo])(?=[1-9]\s*[\/\-\.])/g, '0');
  const fullMatch = fullRepaired.match(regex);
  if (fullMatch) {
    const month = fullMatch[1].padStart(2, '0');
    const year = fullMatch[2];
    const mNum = parseInt(month, 10);
    const yNum = parseInt(year, 10);
    if (mNum >= 1 && mNum <= 12 && yNum >= 24 && yNum <= 39) {
      return { month, year };
    }
  }

  return undefined;
};

/**
 * Detects bank key from scanned text using keyword dictionary.
 */
export const extractBankName = (text: string): string | undefined => {
  const upper = text.toUpperCase();

  for (const item of BANK_KEYWORD_MAP) {
    for (const kw of item.keywords) {
      const regex = new RegExp(`\\b${kw.replace(/&/g, '\\&')}\\b`, 'i');
      if (regex.test(upper)) {
        return item.bankKey;
      }
    }
  }

  return undefined;
};

/**
 * Detects card network (Visa, Mastercard, RuPay, Amex, Diners, Discover)
 * using card number and printed text.
 */
export const extractNetwork = (text: string, cardNumber?: string): string | undefined => {
  const upper = text.toUpperCase();
  if (/\bRUPAY\b/i.test(upper)) return 'RUPAY';
  if (/\bVISA\b/i.test(upper)) return 'VISA';
  if (/\bMASTERCARD\b/i.test(upper)) return 'MASTERCARD';
  if (/\b(?:AMERICAN\s+EXPRESS|AMEX)\b/i.test(upper)) return 'AMEX';
  if (/\bDINERS(?:\s+CLUB)?\b/i.test(upper)) return 'DINERS';
  if (/\bDISCOVER\b/i.test(upper)) return 'DISCOVER';

  if (cardNumber) {
    const detected = detectCardNetwork(cardNumber);
    if (detected) return detected;
  }

  return undefined;
};

/**
 * Detects card type (Credit / Debit) from printed text.
 */
export const extractCardType = (text: string): string | undefined => {
  const upper = text.toUpperCase();
  if (/\bDEBIT\b/i.test(upper) && !/\bCREDIT\b/i.test(upper)) return 'DEBIT';
  if (/\bCREDIT\b/i.test(upper) && !/\bDEBIT\b/i.test(upper)) return 'CREDIT';
  return undefined;
};

/**
 * Extracts cardholder name from text lines.
 * Strictly verifies human name structure and filters out banking words, tiers, and disclaimers.
 */
export const extractCardholderName = (
  lines: string[],
  cardNumber?: string,
  bankKey?: string
): string | undefined => {
  const bankNameStr = bankKey && BANK_DICTIONARY[bankKey] ? BANK_DICTIONARY[bankKey].toUpperCase() : '';
  const bankWords = bankNameStr ? new Set(bankNameStr.split(/\s+/)) : new Set<string>();

  for (const line of lines) {
    const trimmed = line.trim().toUpperCase();

    // Skip lines with digits or punctuation symbols
    if (/[0-9\/\\@#\$%\^&\*_\+=~`<>|:;,\?!(){}\[\]]/.test(trimmed)) continue;

    // Check if line contains letters and spaces only (allowing single dots for initials like S.)
    const cleanLetters = trimmed.replace(/\./g, '');
    if (!/^[A-Z\s]{3,30}$/.test(cleanLetters)) continue;

    const words = cleanLetters.split(/\s+/).filter(w => w.length > 0);
    if (words.length < 2 || words.length > 4) continue;

    // First and last words must be at least 2 letters (names don't start or end with a single initial)
    if (words[0].length < 2 || words[words.length - 1].length < 2) continue;

    // At most one single-letter initial allowed (e.g. "S" in "Rahul S Sharma")
    const singleLetterCount = words.filter(w => w.length === 1).length;
    if (singleLetterCount > 1) continue;

    // Check exclusions: if ANY word matches banking terms, brands, or filler words
    const hasExclusion = words.some(w => NAME_EXCLUSIONS.has(w) || bankWords.has(w));
    if (hasExclusion) continue;

    // Total length check (names are typically 5 to 26 characters)
    const totalLength = words.join(' ').length;
    if (totalLength < 5 || totalLength > 26) continue;

    return words
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  }

  return undefined;
};

/**
 * Extracts CVV / CVC / CID code if printed on card.
 * Improved with standalone 3-digit detection, broader labels, and false-positive filtering.
 */
export const extractCvv = (fullText: string, lines: string[], cardNumber?: string): string | undefined => {
  // Build a set of digit sequences to EXCLUDE from CVV candidates
  const excludedDigits = new Set<string>();
  if (cardNumber) {
    const cardDigits = cardNumber.replace(/\D/g, '');
    if (cardDigits.length >= 3) {
      for (let i = 0; i <= cardDigits.length - 3; i++) {
        excludedDigits.add(cardDigits.substring(i, i + 3));
      }
    }
  }

  const isValidCvv = (candidate: string): boolean => {
    if (candidate.length < 3 || candidate.length > 4) return false;
    if (candidate.split('').every(c => c === candidate[0])) return false;
    if (excludedDigits.has(candidate)) return false;
    return true;
  };

  // Pattern 1: Explicit labels like CVV 123, CVC: 456, CID: 1234, SECURITY CODE: 789
  const labeledRegex = /(?:\b(?:CVV2?|CVC2?|CID|SECURITY\s*CODE|SEC(?:URITY)?\s*(?:NO|NUM|NUMBER|CODE)?)\b)[\s:#\.-]*([0-9]{3,4})\b/i;
  const labeledMatch = fullText.match(labeledRegex);
  if (labeledMatch && labeledMatch[1]) {
    const candidate = labeledMatch[1];
    if (candidate.length in [3, 4] || (candidate.length >= 3 && candidate.length <= 4 && !candidate.split('').every(c => c === candidate[0]))) {
      return candidate;
    }
  }

  // Pattern 2: Line with label and next line with 3-4 digits
  for (let i = 0; i < lines.length - 1; i++) {
    const trimmed = lines[i].trim();
    if (/^(?:CVV2?|CVC2?|CID|SEC(?:URITY)?(?:\s*CODE)?)$/i.test(trimmed)) {
      const nextDigits = cleanOcrDigits(lines[i + 1].trim()).replace(/\D/g, '');
      if (nextDigits.length >= 3 && nextDigits.length <= 4 && !nextDigits.split('').every(c => c === nextDigits[0])) {
        return nextDigits;
      }
    }
  }

  // Pattern 3: Signature strip pattern: 4 digits of card number followed by 3 digits (e.g. 5671 123)
  if (cardNumber) {
    const rawDigits = cardNumber.replace(/\D/g, '');
    const last4 = rawDigits.slice(-4);
    if (last4) {
      const last4Regex = new RegExp(`\\b${last4}\\s+([0-9]{3})\\b`);
      const last4Match = fullText.match(last4Regex);
      if (last4Match && last4Match[1] && !last4Match[1].split('').every(c => c === last4Match[1][0])) {
        return last4Match[1];
      }
    }
  }

  // Pattern 4: Standalone 3-digit number on card back (no label needed)
  const datePattern = /(?:0[1-9]|1[0-2])\s*[\/\-\.]\s*[0-9]{2,4}/;
  for (const line of lines) {
    const trimmed = line.trim();
    if (datePattern.test(trimmed)) continue;
    if (/^[A-Za-z\s]+$/.test(trimmed)) continue;

    const standaloneRegex = /\b([0-9]{3})\b/g;
    let match: RegExpExecArray | null;
    while ((match = standaloneRegex.exec(trimmed)) !== null) {
      const candidate = match[1];
      if (isValidCvv(candidate)) return candidate;
    }
  }

  return undefined;
};

/**
 * Main parser function: takes all detected OCR lines and returns structured card data.
 */
export const parseCardOCR = (lines: string[]): ParsedCardData => {
  const fullText = lines.join('\n');

  // 1. Extract card number (supports horizontal and vertical stacked layouts)
  const cardNumber = extractCardNumber(fullText, lines);

  // 2. Extract expiry (supports multi-line and single-line)
  const exp = extractExpiry(fullText, lines);
  const month = exp?.month;
  const year = exp?.year;

  // 3. Extract bank
  const bankName = extractBankName(fullText);

  // 4. Extract network
  const network = extractNetwork(fullText, cardNumber);

  // 5. Extract card type
  const cardType = extractCardType(fullText);

  // 6. Extract cardholder name
  const ownerName = extractCardholderName(lines, cardNumber, bankName);

  // 7. Extract CVV / CVC
  const cvv = extractCvv(fullText, lines, cardNumber);

  return {
    cardNumber,
    month,
    year,
    ownerName,
    bankName,
    network,
    cardType,
    cvv,
  };
};
