import { NativeModules, Platform, PermissionsAndroid, Alert } from 'react-native';
import { ParsedCardData, isValidLuhn, extractCardNumber } from '../util/CardParser';
import { formatCardNumber, detectCardNetwork } from '../util/Utils';

const { CardScannerModule } = NativeModules;

export interface RawScannedCardResult {
  cardNumber?: string;
  month?: string;
  year?: string;
  network?: string;
  bankName?: string;
  cardType?: string;
  ownerName?: string;
  cvv?: string;
}

/**
 * Checks whether camera hardware is available on the device.
 */
export const isCameraAvailable = async (): Promise<boolean> => {
  if (!CardScannerModule?.isCameraSupported) {
    return false;
  }
  try {
    return await CardScannerModule.isCameraSupported();
  } catch {
    return false;
  }
};

/**
 * Requests camera permission from the operating system.
 */
export const requestCameraPermission = async (): Promise<boolean> => {
  if (Platform.OS === 'android') {
    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.CAMERA,
        {
          title: 'Camera Access Needed',
          message: 'EWallet needs camera permission to automatically scan your physical debit or credit card.',
          buttonPositive: 'Allow',
          buttonNegative: 'Cancel',
        }
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    } catch {
      return false;
    }
  }

  // iOS requests camera permission automatically on first AVCaptureDevice access
  return true;
};

/**
 * Launches the native live camera card scanner.
 * Automatically scans the physical card within the rectangular frame using real-time OCR.
 * Returns the recognized card data, or null if cancelled.
 */
export const scanPaymentCard = async (): Promise<ParsedCardData | null> => {
  if (!CardScannerModule?.scanCard) {
    Alert.alert(
      'Scanner Unavailable',
      'Card scanning is not supported on this platform version. Please enter card details manually.'
    );
    return null;
  }

  const hasPerm = await requestCameraPermission();
  if (!hasPerm) {
    Alert.alert(
      'Camera Permission Required',
      'Please allow camera access in your device Settings to scan your payment card.'
    );
    return null;
  }

  try {
    const rawResult: RawScannedCardResult | null = await CardScannerModule.scanCard();
    if (!rawResult || !rawResult.cardNumber) {
      return null;
    }

    // Format & validate card number
    let cleanNumber = rawResult.cardNumber.replace(/\D/g, '');
    let formattedNumber = formatCardNumber(cleanNumber);

    // If needed, detect network from number
    let network = rawResult.network || '';
    if (!network && cleanNumber) {
      network = detectCardNetwork(cleanNumber);
    }

    // Format month to 2 digits
    let month = rawResult.month ? rawResult.month.padStart(2, '0') : '';
    let year = rawResult.year || '';
    if (year.length === 4) {
      year = year.slice(-2);
    }

    let cvv = rawResult.cvv ? rawResult.cvv.replace(/\D/g, '') : '';
    if (cvv.length > 4) cvv = cvv.slice(0, 4);

    return {
      cardNumber: formattedNumber,
      month,
      year,
      network,
      bankName: rawResult.bankName || '',
      cardType: rawResult.cardType || '',
      ownerName: rawResult.ownerName || '',
      cvv,
    };
  } catch (error: any) {
    console.error('Card scanning failed:', error);
    const msg = error?.message || 'Failed to scan card.';
    if (!msg.toLowerCase().includes('cancel')) {
      Alert.alert('Scan Notice', 'Could not scan card. Please enter details manually.');
    }
    return null;
  }
};

