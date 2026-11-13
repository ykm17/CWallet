import NfcManager, { NfcTech } from 'react-native-nfc-manager';
import { detectCardNetwork, detectCardType } from './Utils';

export interface ScannedCardData {
  cardNumber: string;
  expiryMonth: string;
  expiryYear: string;
  ownerName?: string;
  cardName?: string;
  network?: string;
  cardType?: string;
}

// Convert byte array to hexadecimal string
const bytesToHex = (bytes: number[]): string => {
  return bytes
    .map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
};

// Convert hex string to byte array
const hexToBytes = (hex: string): number[] => {
  const cleanHex = hex.replace(/\s+/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes.push(parseInt(cleanHex.substring(i, i + 2), 16));
  }
  return bytes;
};

// Luhn algorithm (Mod 10) validation
const isValidLuhn = (pan: string): boolean => {
  const clean = pan.replace(/\D/g, '');
  if (clean.length < 13 || clean.length > 19) return false;

  let sum = 0;
  let double = false;
  for (let i = clean.length - 1; i >= 0; i--) {
    let digit = parseInt(clean.charAt(i), 10);
    if (isNaN(digit)) return false;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
};

// Strict BER-TLV Parser: parses TLV structures accurately without false positives
interface TLVNode {
  tag: string;
  value: number[];
}

const parseBERTLV = (bytes: number[]): Map<string, number[]> => {
  const map = new Map<string, number[]>();

  const traverse = (data: number[]) => {
    let i = 0;
    while (i < data.length) {
      // 1. Parse Tag
      const tagStart = i;
      const b0 = data[i] & 0xff;
      i++;
      if (i > data.length) break;

      // Multi-byte tag if lower 5 bits are all 1s (0x1F)
      if ((b0 & 0x1f) === 0x1f) {
        while (i < data.length && (data[i] & 0x80) !== 0) {
          i++;
        }
        i++; // Last tag byte
      }
      if (i > data.length) break;

      const tagHex = bytesToHex(data.slice(tagStart, i));

      // Skip invalid / padding tags (00 or FF)
      if (tagHex === '00' || tagHex === 'FF') {
        continue;
      }

      // 2. Parse Length
      if (i >= data.length) break;
      let len = data[i] & 0xff;
      i++;

      if (len === 0x81) {
        if (i >= data.length) break;
        len = data[i] & 0xff;
        i++;
      } else if (len === 0x82) {
        if (i + 1 >= data.length) break;
        len = ((data[i] & 0xff) << 8) | (data[i + 1] & 0xff);
        i += 2;
      } else if (len > 0x82) {
        // Reserved length, ignore
        break;
      }

      if (i + len > data.length) {
        // Malformed length
        len = data.length - i;
      }

      const valBytes = data.slice(i, i + len);
      i += len;

      map.set(tagHex, valBytes);

      // 3. If constructed tag (bit 6 is 1, e.g. 6F, 77, A5, BF0C, 70), recurse
      if ((b0 & 0x20) !== 0) {
        traverse(valBytes);
      }
    }
  };

  traverse(bytes);
  return map;
};

// Common EMV Application Identifiers (AIDs)
const KNOWN_AIDS = [
  'A0000000031010',   // Visa Credit/Debit
  'A0000000041010',   // Mastercard Credit/Debit
  'A0000000032010',   // Visa Electron
  'A000000005241010', // RuPay Credit/Debit
  'A00000002501',     // American Express
  'A0000000043060',   // Maestro
  'A0000001523010',   // Discover
];

// PPSE Command: SELECT '2PAY.SYS.DDF01'
const PPSE_COMMAND = [
  0x00, 0xa4, 0x04, 0x00, 0x0e,
  0x32, 0x50, 0x41, 0x59, 0x2e, 0x53, 0x59, 0x53, 0x2e, 0x44, 0x44, 0x46, 0x30, 0x31,
  0x00,
];

// Detect card branding
export const detectCardName = (pan: string, label: string = ''): string => {
  if (label && label.length >= 3) {
    const cleanLabel = label
      .replace(/[^a-zA-Z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleanLabel.length >= 3) {
      return cleanLabel
        .toLowerCase()
        .split(' ')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
    }
  }

  const cleanPan = pan.replace(/\D/g, '');
  if (cleanPan.startsWith('4')) return 'Visa Card';
  if (/^(5[1-5]|2[2-7])/.test(cleanPan)) return 'Mastercard';
  if (/^(60|65|81|82|508)/.test(cleanPan)) return 'RuPay Card';
  if (/^(34|37)/.test(cleanPan)) return 'American Express';
  if (/^(30[0-5]|3095|36|38|39)/.test(cleanPan)) return 'Diners Club';
  return 'Credit Card';
};

// Parse ASCII text from bytes
const bytesToAscii = (bytes: number[]): string => {
  let str = '';
  for (const b of bytes) {
    const val = b & 0xff;
    if (val >= 32 && val <= 126) {
      str += String.fromCharCode(val);
    }
  }
  return str.trim();
};

// Build GPO command dynamically matching the card's PDOL requirements
const buildGPOCommand = (pdolBytes?: number[]): number[] => {
  if (!pdolBytes || pdolBytes.length === 0) {
    // Default GPO command with empty PDOL: 80 A8 00 00 02 83 00 00
    return [0x80, 0xa8, 0x00, 0x00, 0x02, 0x83, 0x00, 0x00];
  }

  // Parse PDOL tag-length pairs
  let i = 0;
  const terminalData: number[] = [];

  while (i < pdolBytes.length) {
    const b0 = pdolBytes[i] & 0xff;
    const tagStart = i;
    i++;
    if ((b0 & 0x1f) === 0x1f) {
      while (i < pdolBytes.length && (pdolBytes[i] & 0x80) !== 0) {
        i++;
      }
      i++;
    }
    if (i >= pdolBytes.length) break;

    const tagHex = bytesToHex(pdolBytes.slice(tagStart, i));
    const len = pdolBytes[i] & 0xff;
    i++;

    // Fill appropriate terminal data for each requested PDOL tag
    if (tagHex === '9F66') {
      // Terminal Transaction Qualifiers (TTQ): contactless MSD and qVSDC capable
      const ttq = [0x28, 0x00, 0x00, 0x00];
      for (let k = 0; k < len; k++) {
        terminalData.push(k < ttq.length ? ttq[k] : 0x00);
      }
    } else if (tagHex === '9F1A' || tagHex === '5F2A') {
      // Terminal Country Code / Currency Code (0356 for India, or 0840)
      const code = [0x03, 0x56];
      for (let k = 0; k < len; k++) {
        terminalData.push(k < code.length ? code[k] : 0x00);
      }
    } else if (tagHex === '9A') {
      // Transaction Date (YYMMDD)
      const now = new Date();
      const yy = parseInt(now.getFullYear().toString().slice(-2), 10);
      const mm = now.getMonth() + 1;
      const dd = now.getDate();
      terminalData.push(
        ((Math.floor(yy / 10) << 4) | (yy % 10)) & 0xff,
        ((Math.floor(mm / 10) << 4) | (mm % 10)) & 0xff,
        ((Math.floor(dd / 10) << 4) | (dd % 10)) & 0xff,
      );
    } else {
      // Default: zero bytes of the requested length
      for (let k = 0; k < len; k++) {
        terminalData.push(0x00);
      }
    }
  }

  // APDU: CLA INS P1 P2 Lc [83 len data] Le
  const lc = terminalData.length + 2;
  return [0x80, 0xa8, 0x00, 0x00, lc, 0x83, terminalData.length, ...terminalData, 0x00];
};

// Parse AFL (Application File Locator) from GPO response
const parseAFL = (tlvMap: Map<string, number[]>): Array<{ sfi: number; firstRec: number; lastRec: number }> => {
  const records: Array<{ sfi: number; firstRec: number; lastRec: number }> = [];

  let aflBytes = tlvMap.get('94');
  if (!aflBytes && tlvMap.has('80')) {
    // Format 1 GPO response (Tag 80: [AIP (2 bytes)] [AFL...])
    const tag80 = tlvMap.get('80')!;
    if (tag80.length > 2) {
      aflBytes = tag80.slice(2);
    }
  }

  if (aflBytes && aflBytes.length >= 4) {
    for (let i = 0; i <= aflBytes.length - 4; i += 4) {
      const sfi = (aflBytes[i] & 0xff) >> 3;
      const firstRec = aflBytes[i + 1] & 0xff;
      const lastRec = aflBytes[i + 2] & 0xff;
      if (sfi >= 1 && sfi <= 31 && firstRec >= 1 && lastRec >= firstRec) {
        records.push({ sfi, firstRec, lastRec });
      }
    }
  }

  return records;
};

// Extract details from parsed BER-TLV Map
const extractDetailsFromTLVMap = (
  tlvMap: Map<string, number[]>,
  current: Partial<ScannedCardData>,
): Partial<ScannedCardData> => {
  const result: Partial<ScannedCardData> = { ...current };

  // 1. Track 2 Equivalent Data (Tag 57 or Tag 9F6B)
  const track2Bytes = tlvMap.get('57') || tlvMap.get('9F6B');
  if (track2Bytes) {
    const track2Hex = bytesToHex(track2Bytes);
    // Format: PAN + 'D' + YYMM + ...
    const match = track2Hex.match(/([0-9]{13,19})[D=]([0-9]{2})([0-9]{2})/i);
    if (match) {
      const candidatePan = match[1];
      if (isValidLuhn(candidatePan)) {
        result.cardNumber = candidatePan;
        result.expiryYear = match[2]; // 2-digit year (e.g. '27')
        result.expiryMonth = match[3]; // 2-digit month (e.g. '08')
      }
    }
  }

  // 2. Application PAN (Tag 5A) - only accept if valid Luhn
  if (!result.cardNumber && tlvMap.has('5A')) {
    const panHex = bytesToHex(tlvMap.get('5A')!).replace(/[Ff]$/, '');
    if (/^\d{13,19}$/.test(panHex) && isValidLuhn(panHex)) {
      result.cardNumber = panHex;
    }
  }

  // 3. Application Expiration Date (Tag 5F24) - format: YYMMDD
  if ((!result.expiryMonth || !result.expiryYear) && tlvMap.has('5F24')) {
    const expHex = bytesToHex(tlvMap.get('5F24')!);
    if (expHex.length >= 4) {
      const yy = expHex.substring(0, 2);
      const mm = expHex.substring(2, 4);
      const mmNum = parseInt(mm, 10);
      if (mmNum >= 1 && mmNum <= 12) {
        result.expiryYear = yy;
        result.expiryMonth = mm;
      }
    }
  }

  // 4. Cardholder Name (Tag 5F20)
  if (!result.ownerName && tlvMap.has('5F20')) {
    const name = bytesToAscii(tlvMap.get('5F20')!).replace('/', ' ').trim();
    if (name.length >= 2 && !/^\d+$/.test(name)) {
      result.ownerName = name;
    }
  }

  // 5. Application Label (Tag 50) and Preferred Name (Tag 9F12)
  if (!result.cardName) {
    if (tlvMap.has('9F12')) {
      const preferred = bytesToAscii(tlvMap.get('9F12')!);
      if (preferred.length >= 3) result.cardName = preferred;
    } else if (tlvMap.has('50')) {
      const label = bytesToAscii(tlvMap.get('50')!);
      if (label.length >= 3) result.cardName = label;
    }
  }

  return result;
};

// Check if device supports NFC
export const isNfcSupported = async (): Promise<boolean> => {
  try {
    return await NfcManager.isSupported();
  } catch {
    return false;
  }
};

// Check if NFC is enabled in system settings
export const isNfcEnabled = async (): Promise<boolean> => {
  try {
    return await NfcManager.isEnabled();
  } catch {
    return false;
  }
};

// Open device settings
export const goToNfcSettings = async (): Promise<void> => {
  try {
    await NfcManager.goToNfcSetting();
  } catch {
    // Ignore error
  }
};

// Cancel ongoing NFC scan
export const cancelNfcScan = async (): Promise<void> => {
  try {
    await NfcManager.cancelTechnologyRequest();
  } catch {
    // Ignore error
  }
};

// Scan contactless EMV card and return validated card details
export const scanCardWithNfc = async (): Promise<ScannedCardData> => {
  const supported = await isNfcSupported();
  if (!supported) {
    throw new Error('NFC is not supported on this device.');
  }

  const enabled = await isNfcEnabled();
  if (!enabled) {
    throw new Error('NFC is disabled. Please enable NFC in your device settings.');
  }

  await NfcManager.start();

  try {
    await NfcManager.requestTechnology(NfcTech.IsoDep);

    let collectedData: Partial<ScannedCardData> = {};

    // Step 1: Select PPSE (2PAY.SYS.DDF01) to discover active AIDs on card
    let aidsToTry: string[] = [];
    try {
      const ppseResp = await NfcManager.isoDepHandler.transceive(PPSE_COMMAND);
      const ppseMap = parseBERTLV(ppseResp);
      // Extract AID from Tag 4F
      if (ppseMap.has('4F')) {
        aidsToTry.push(bytesToHex(ppseMap.get('4F')!));
      }
    } catch {
      // PPSE not available, use known AIDs
    }

    // Include all known AIDs
    for (const aid of KNOWN_AIDS) {
      if (!aidsToTry.includes(aid)) {
        aidsToTry.push(aid);
      }
    }

    // Step 2: Traverse AIDs and interact with payment application
    for (const aid of aidsToTry) {
      try {
        const aidBytes = hexToBytes(aid);
        const selectAidCmd = [0x00, 0xa4, 0x04, 0x00, aidBytes.length, ...aidBytes, 0x00];
        const selectResp = await NfcManager.isoDepHandler.transceive(selectAidCmd);

        // Check SW1-SW2 (90 00 or 61 xx indicates success)
        const sw1 = selectResp.length >= 2 ? selectResp[selectResp.length - 2] : 0;
        const sw2 = selectResp.length >= 1 ? selectResp[selectResp.length - 1] : 0;
        const isSuccess = (sw1 === 0x90 && sw2 === 0x00) || sw1 === 0x61;

        if (!isSuccess) {
          continue;
        }

        // Parse Select Response FCI
        const fciMap = parseBERTLV(selectResp);
        collectedData = extractDetailsFromTLVMap(fciMap, collectedData);

        // Step 3: Get Processing Options (GPO)
        // Check if card requires specific PDOL data (Tag 9F38)
        const pdolBytes = fciMap.get('9F38');
        let gpoCmd = buildGPOCommand(pdolBytes);
        let gpoResp: number[] = [];

        try {
          gpoResp = await NfcManager.isoDepHandler.transceive(gpoCmd);
        } catch {
          // If PDOL failed, fallback to standard empty PDOL
          try {
            gpoCmd = [0x80, 0xa8, 0x00, 0x00, 0x02, 0x83, 0x00, 0x00];
            gpoResp = await NfcManager.isoDepHandler.transceive(gpoCmd);
          } catch {
            // Ignore GPO failure
          }
        }

        let gpoMap = new Map<string, number[]>();
        if (gpoResp.length > 2) {
          gpoMap = parseBERTLV(gpoResp);
          collectedData = extractDetailsFromTLVMap(gpoMap, collectedData);
        }

        // Step 4: Read Records from Application File Locator (AFL)
        const aflRecords = parseAFL(gpoMap);
        const recordsToRead: Array<{ sfi: number; rec: number }> = [];

        if (aflRecords.length > 0) {
          for (const item of aflRecords) {
            for (let r = item.firstRec; r <= item.lastRec; r++) {
              recordsToRead.push({ sfi: item.sfi, rec: r });
            }
          }
        } else {
          // Fallback: Read common SFIs (1, 2, 3) and records (1 to 5)
          for (let s = 1; s <= 3; s++) {
            for (let r = 1; r <= 5; r++) {
              recordsToRead.push({ sfi: s, rec: r });
            }
          }
        }

        for (const { sfi, rec } of recordsToRead) {
          try {
            const readCmd = [0x00, 0xb2, rec, (sfi << 3) | 4, 0x00];
            const recResp = await NfcManager.isoDepHandler.transceive(readCmd);

            if (recResp.length > 2) {
              const recMap = parseBERTLV(recResp);
              collectedData = extractDetailsFromTLVMap(recMap, collectedData);

              // Stop if all core fields have been found and validated
              if (
                collectedData.cardNumber &&
                collectedData.expiryMonth &&
                collectedData.expiryYear &&
                collectedData.ownerName
              ) {
                break;
              }
            }
          } catch {
            // Ignore record read error
          }
        }

        // Validate collected card number with Luhn algorithm
        if (collectedData.cardNumber && isValidLuhn(collectedData.cardNumber)) {
          const rawLabel = collectedData.cardName || '';
          const detectedCardName = detectCardName(collectedData.cardNumber, rawLabel);
          const detectedNetwork = detectCardNetwork(collectedData.cardNumber, rawLabel);
          const detectedType = detectCardType(rawLabel);

          return {
            cardNumber: collectedData.cardNumber,
            expiryMonth: collectedData.expiryMonth || '',
            expiryYear: collectedData.expiryYear || '',
            ownerName: collectedData.ownerName || '',
            cardName: detectedCardName,
            network: detectedNetwork,
            cardType: detectedType,
          };
        }
      } catch {
        // Try next AID
      }
    }

    throw new Error(
      'Could not read valid card details. Please ensure the card is contactless and hold it flat against the back of your phone for 2-3 seconds.'
    );
  } finally {
    await cancelNfcScan();
  }
};
