import { NativeModules, Platform, PermissionsAndroid } from 'react-native';
import { Alert } from '../components/CustomAlert';
import { Card } from '../types/Types';
import { APP_NAME, BANK_DICTIONARY } from '../constants/Constants';

const { CardOverlayModule } = NativeModules;

export interface OverlayCardData {
  bankName: string;
  cardName: string;
  cardNumber: string;
  last4: string;
  expiry: string;
  cvv: string;
}

/**
 * Checks if the platform can draw overlays (Android requires SYSTEM_ALERT_WINDOW permission).
 */
export const canDrawOverlays = async (): Promise<boolean> => {
  if (!CardOverlayModule?.canDrawOverlays) {
    return false;
  }
  try {
    return await CardOverlayModule.canDrawOverlays();
  } catch {
    return false;
  }
};

/**
 * Opens system settings to request overlay permission on Android,
 * or requests notification authorization on iOS.
 */
export const requestOverlayPermission = (): void => {
  if (CardOverlayModule?.requestOverlayPermission) {
    CardOverlayModule.requestOverlayPermission();
  }
};

/**
 * Checks current permission status without prompting.
 */
export const checkAppPermissionsStatus = async (): Promise<{
  overlayGranted: boolean;
  notificationsGranted: boolean;
}> => {
  let overlayGranted = true;
  let notificationsGranted = true;

  if (Platform.OS === 'android') {
    overlayGranted = await canDrawOverlays();
    if (typeof Platform.Version === 'number' && Platform.Version >= 33) {
      try {
        notificationsGranted = await PermissionsAndroid.check(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
        );
      } catch {
        notificationsGranted = false;
      }
    }
  }

  return { overlayGranted, notificationsGranted };
};

/**
 * Requests all required system permissions for the card assistant (overlay and notifications).
 */
export const requestAllAppPermissions = async (): Promise<{
  overlayGranted: boolean;
  notificationsGranted: boolean;
}> => {
  let notificationsGranted = true;
  let overlayGranted = true;

  if (Platform.OS === 'android') {
    // 1. Android 13+ Notification Permission
    if (typeof Platform.Version === 'number' && Platform.Version >= 33) {
      try {
        const res = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
          {
            title: 'Notification Permission',
            message: `${APP_NAME} needs notification access to show your card assistant during payments.`,
            buttonPositive: 'Allow',
          }
        );
        notificationsGranted = res === PermissionsAndroid.RESULTS.GRANTED;
      } catch {
        notificationsGranted = false;
      }
    }

    // 2. Android Overlay Permission ("Display over other apps")
    overlayGranted = await canDrawOverlays();
    if (!overlayGranted) {
      requestOverlayPermission();
    }
  } else if (Platform.OS === 'ios') {
    // iOS Notification Permission (Alert, Sound, Badge)
    requestOverlayPermission();
    overlayGranted = true;
    notificationsGranted = true;
  }

  return { overlayGranted, notificationsGranted };
};

/**
 * Shows the floating overlay UI containing expiry and CVV,
 * and sends the app to the background so the user can easily pay in other apps.
 * Works on Android (floating draggable window over other apps) and iOS (system banner over other apps).
 */
export const showCardOverlay = async (card: Card): Promise<boolean> => {
  if (!CardOverlayModule?.showCardOverlay) {
    return false;
  }

  // On Android, check if "Display over other apps" is allowed
  if (Platform.OS === 'android') {
    const hasPermission = await canDrawOverlays();
    if (!hasPermission) {
      Alert.alert(
        'Display Over Other Apps',
        'To show your card\'s Expiry and CVV in a floating overlay while paying in other apps, enable "Display over other apps" in Settings.',
        [
          { text: 'Not Now', style: 'cancel' },
          {
            text: 'Open Settings',
            onPress: () => requestOverlayPermission(),
          },
        ],
      );
      return false;
    }
  }

  const month = card.month ? card.month.padStart(2, '0') : '';
  const year = card.year ? card.year.slice(-2) : '';
  const expiry = month && year ? `${month}/${year}` : month || year || '';
  const rawNumber = card.number ? card.number.trim() : '';
  const cleanNumber = rawNumber.replace(/\s+/g, '');
  const formattedNumber = rawNumber.includes(' ')
    ? rawNumber
    : cleanNumber.replace(/(.{4})/g, '$1 ').trim();
  const last4 = cleanNumber.slice(-4);
  const bankName = BANK_DICTIONARY[card.bankName] || card.bankName || '';
  const cardName = card.name || card.ownerName || 'Card';

  try {
    return await CardOverlayModule.showCardOverlay({
      bankName,
      cardName,
      cardNumber: formattedNumber,
      last4,
      expiry,
      cvv: card.cvv || '',
    });
  } catch (error) {
    console.warn('Could not launch card overlay:', error);
    return false;
  }
};

/**
 * Hides/dismisses the active card overlay.
 */
export const hideCardOverlay = (): void => {
  if (CardOverlayModule?.hideCardOverlay) {
    CardOverlayModule.hideCardOverlay();
  }
};

/**
 * Moves the app to the background.
 */
export const minimizeApp = (): void => {
  if (CardOverlayModule?.minimizeApp) {
    CardOverlayModule.minimizeApp();
  }
};

