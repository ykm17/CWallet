import ReactNativeBiometrics, { BiometryTypes } from 'react-native-biometrics';

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

export const authenticateWithBiometrics = async (): Promise<boolean> => {
    try {
        const { success } = await rnBiometrics.simplePrompt({
            promptMessage: 'Authenticate to access CWallet',
            cancelButtonText: 'Cancel'
        });
        console.log('Biometric authentication result:', success);
        return success;
    } catch (error) {
        console.error('Error during biometric authentication:', error);
        return false;
    }
}; 