import React, { createContext, useState, useEffect, ReactNode, useContext } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { authenticateWithBiometrics, checkBiometricAvailability } from './Biometric';

export type PrivacyContextType = {
  isPrivacyMode: boolean;
  togglePrivacyMode: () => Promise<boolean>;
  setPrivacyMode: (enabled: boolean) => void;
  hideCards: () => void;
  unhideWithBiometrics: () => Promise<boolean>;
};

export const PrivacyContext = createContext<PrivacyContextType>({
  isPrivacyMode: true, // Always hidden by default
  togglePrivacyMode: async () => false,
  setPrivacyMode: () => {},
  hideCards: () => {},
  unhideWithBiometrics: async () => false,
});

type PrivacyProviderProps = {
  children: ReactNode;
};

export const PrivacyProvider: React.FC<PrivacyProviderProps> = ({ children }) => {
  // Always hidden by default on app launch / cold start
  const [isPrivacyMode, setIsPrivacyMode] = useState<boolean>(true);

  useEffect(() => {
    // Automatically re-hide cards whenever the app goes to background or becomes inactive
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        setIsPrivacyMode(true);
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  // Hide directly without prompt
  const hideCards = () => {
    setIsPrivacyMode(true);
  };

  // Unhide requiring biometric verification
  const unhideWithBiometrics = async (): Promise<boolean> => {
    try {
      const isBioAvailable = await checkBiometricAvailability();
      if (isBioAvailable) {
        const success = await authenticateWithBiometrics('Authenticate to reveal card details');
        if (success) {
          setIsPrivacyMode(false);
          return true;
        }
        return false;
      } else {
        // Biometrics unavailable on device
        setIsPrivacyMode(false);
        return true;
      }
    } catch (err) {
      console.warn('Error during unhide biometric authentication:', err);
      return false;
    }
  };

  // Toggle: hide directly, but ask biometric to unhide
  const togglePrivacyMode = async (): Promise<boolean> => {
    if (!isPrivacyMode) {
      hideCards();
      return true;
    } else {
      return unhideWithBiometrics();
    }
  };

  return (
    <PrivacyContext.Provider
      value={{
        isPrivacyMode,
        togglePrivacyMode,
        setPrivacyMode: setIsPrivacyMode,
        hideCards,
        unhideWithBiometrics,
      }}
    >
      {children}
    </PrivacyContext.Provider>
  );
};

export const usePrivacy = (): PrivacyContextType => useContext(PrivacyContext);
