import ReactNativeBiometrics, { BiometryTypes } from 'react-native-biometrics';
import { APP_NAME } from '../constants/Constants';

const rnBiometrics = new ReactNativeBiometrics();

export const checkBiometricAvailability = async (): Promise<boolean> => {
    try {
        const { available, biometryType } = await rnBiometrics.isSensorAvailable();
        console.log('Biometric availability:', available, 'Type:', biometryType);
        return available;
    } catch (error) {
        console.error('Error checking biometric availability:', error);
        return false;
    }
};

export const getBiometricDetails = async (): Promise<{ available: boolean; biometryType?: string }> => {
    try {
        const { available, biometryType } = await rnBiometrics.isSensorAvailable();
        return { available, biometryType };
    } catch (error) {
        console.error('Error fetching biometric details:', error);
        return { available: false };
    }
};

export const authenticateWithBiometrics = async (): Promise<boolean> => {
    try {
        const { success } = await rnBiometrics.simplePrompt({
            promptMessage: `Authenticate to access ${APP_NAME}`,
            cancelButtonText: 'Cancel'
        });
        console.log('Biometric authentication result:', success);
        return success;
    } catch (error) {
        console.error('Error during biometric authentication:', error);
        return false;
    }
}; 