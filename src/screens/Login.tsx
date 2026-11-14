import React, { useEffect, useRef, useState, useContext, useCallback } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../App';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import auth from '@react-native-firebase/auth';
import { getFirestore, doc, getDoc } from '@react-native-firebase/firestore';
import { upsertCurrentUserProfile } from '../services/userService';
import { activatePendingMembershipsForUser } from '../services/groupService';
import { activatePendingCardAccessForUser } from '../services/sharingService';
import { Text, Snackbar, Icon } from 'react-native-paper';
import {
  checkBiometricAvailability,
  authenticateWithBiometrics,
  getBiometricDetails,
} from '../util/Biometric';
import { requestAllAppPermissions } from '../services/cardOverlayService';
import { ConnectivityContext } from '../util/Connectivity';
import { APP_NAME, WEB_CLIENT_ID } from '../constants/Constants';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

const Login: React.FC<Props> = ({ navigation }) => {
  const [loginDisabled, setLoginDisabled] = useState(false);
  const [visible, setVisible] = useState(false);
  const [errorMessage, setErrorMessage] = useState('Error signing in. Please try again.');
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [isAlreadyLoggedIn, setIsAlreadyLoggedIn] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [biometryType, setBiometryType] = useState<string | null>(null);

  const { isConnected } = useContext(ConnectivityContext);
  const isAuthenticatingRef = useRef(false);
  const isSigningInWithGoogle = useRef(false);

  // Fetch biometric sensor details (Face ID, Touch ID, or Biometrics)
  const initBiometrics = useCallback(async () => {
    try {
      const bio = await getBiometricDetails();
      setBiometryType(bio.biometryType || null);
    } catch (e) {
      console.log('Error detecting biometrics:', e);
    }
  }, []);

  useEffect(() => {
    GoogleSignin.configure({
      webClientId: WEB_CLIENT_ID,
    });

    initBiometrics();

    // Automatically ask all permissions needed on the login page
    const timer = setTimeout(() => {
      requestAllAppPermissions().catch((e) => {
        console.log('Error requesting permissions:', e);
      });
    }, 600);

    return () => {
      clearTimeout(timer);
    };
  }, [initBiometrics]);

  // Auth state listener: does NOT auto-trigger biometrics!
  useEffect(() => {
    let isMounted = true;

    const unsubscribe = auth().onAuthStateChanged(async (currentUser) => {
      if (!isMounted) return;
      if (isSigningInWithGoogle.current) return;

      if (currentUser) {
        setIsAlreadyLoggedIn(true);
        setUserEmail(currentUser.email || null);
        // User explicitly taps the unlock button
      } else {
        setIsAlreadyLoggedIn(false);
        setUserEmail(null);
      }
      setCheckingAuth(false);
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  const handleBiometricLogin = async () => {
    if (isAuthenticatingRef.current || loginDisabled) return;
    isAuthenticatingRef.current = true;
    setLoginDisabled(true);

    try {
      const isBioAvailable = await checkBiometricAvailability();
      if (isBioAvailable) {
        const isAuthenticated = await authenticateWithBiometrics();
        if (isAuthenticated) {
          await upsertCurrentUserProfile();
          await Promise.allSettled([
            activatePendingMembershipsForUser(),
            activatePendingCardAccessForUser(),
          ]);
          navigation.reset({
            index: 0,
            routes: [{ name: 'Home' }],
          });
          return;
        } else {
          setErrorMessage('Biometric authentication cancelled or not recognized.');
          setVisible(true);
        }
      } else {
        // Biometrics unavailable on device; proceed to Home for signed-in user
        await upsertCurrentUserProfile();
        await Promise.allSettled([
          activatePendingMembershipsForUser(),
          activatePendingCardAccessForUser(),
        ]);
        navigation.reset({
          index: 0,
          routes: [{ name: 'Home' }],
        });
        return;
      }
    } catch (error) {
      console.error('Error during biometric authentication:', error);
      setErrorMessage('Authentication failed. Please try again.');
      setVisible(true);
    } finally {
      isAuthenticatingRef.current = false;
      setLoginDisabled(false);
    }
  };

  const signInWithGoogle = async () => {
    try {
      isSigningInWithGoogle.current = true;
      setLoginDisabled(true);

      const hasPlayServices = await GoogleSignin.hasPlayServices();
      if (!hasPlayServices) {
        throw new Error('Google Play Services not available');
      }

      await GoogleSignin.signIn();
      const { idToken } = await GoogleSignin.getTokens();
      const googleCredential = auth.GoogleAuthProvider.credential(idToken);
      const userCredential = await auth().signInWithCredential(googleCredential);
      const currentUser = userCredential.user;

      if (currentUser?.email) {
        const db = getFirestore();
        const accessDoc = await getDoc(doc(db, 'accessList', currentUser.email));
        if (accessDoc.exists()) {
          await upsertCurrentUserProfile();
          await Promise.allSettled([
            activatePendingMembershipsForUser(),
            activatePendingCardAccessForUser(),
          ]);
          navigation.reset({
            index: 0,
            routes: [{ name: 'Home' }],
          });
        } else {
          await auth().signOut();
          try {
            await GoogleSignin.signOut();
          } catch (_) {}
          setIsAlreadyLoggedIn(false);
          setUserEmail(null);
          setErrorMessage(`You do not have access to ${APP_NAME}.`);
          setVisible(true);
        }
      }
    } catch (error) {
      console.error('Google Sign-In Error:', error);
      setErrorMessage('Error signing in. Please try again.');
      setVisible(true);
    } finally {
      setLoginDisabled(false);
      isSigningInWithGoogle.current = false;
    }
  };

  const handleSwitchAccount = async () => {
    try {
      setLoginDisabled(true);
      await auth().signOut();
      try {
        await GoogleSignin.signOut();
      } catch (_) {}
      setIsAlreadyLoggedIn(false);
      setUserEmail(null);
    } catch (error) {
      console.error('Error switching account:', error);
    } finally {
      setLoginDisabled(false);
    }
  };

  const onDismissSnackBar = () => setVisible(false);

  const biometricButtonLabel =
    biometryType === 'FaceID'
      ? 'Unlock with Face ID'
      : biometryType === 'TouchID'
      ? 'Unlock with Touch ID'
      : 'Unlock with Biometrics';

  const biometricIconName =
    biometryType === 'FaceID' ? 'face-recognition' : 'fingerprint';

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="#F4F5F7" />
      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Brand Header */}
        <View style={styles.brandHeader}>
          <View style={styles.brandBox}>
            <Icon source="wallet" size={36} color="#FFFFFF" />
          </View>
          <Text style={styles.brandTitle}>{APP_NAME}</Text>
          <Text style={styles.brandSubtitle}>Secure Card Vault & Payment Assistant</Text>

          <View
            style={[
              styles.statusPill,
              isConnected ? styles.statusOnline : styles.statusOffline,
            ]}
          >
            <View
              style={[
                styles.statusDot,
                isConnected ? styles.statusDotOnline : styles.statusDotOffline,
              ]}
            />
            <Text
              style={[
                styles.statusText,
                isConnected ? styles.statusTextOnline : styles.statusTextOffline,
              ]}
            >
              {isConnected ? 'Online' : 'Offline'}
            </Text>
          </View>
        </View>

        {/* Main Action Card */}
        <View style={styles.cardContainer}>
          {checkingAuth ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="large" color="#111111" />
              <Text style={styles.loadingText}>Checking security credentials...</Text>
            </View>
          ) : isAlreadyLoggedIn ? (
            <View style={styles.authBox}>
              {/* Logged in User Pill */}
              <View style={styles.userProfileRow}>
                <View style={styles.avatarCircle}>
                  <Text style={styles.avatarText}>
                    {userEmail ? userEmail.charAt(0).toUpperCase() : 'U'}
                  </Text>
                </View>
                <View style={styles.userInfo}>
                  <Text style={styles.userEmailText} numberOfLines={1}>
                    {userEmail || 'Signed in'}
                  </Text>
                  <View style={styles.activeSessionRow}>
                    <View style={styles.activeSessionDot} />
                    <Text style={styles.activeSessionText}>Vault Locked</Text>
                  </View>
                </View>
              </View>

              {/* Explicit Biometric Unlock Button (No auto trigger) */}
              <TouchableOpacity
                style={[
                  styles.primaryButton,
                  loginDisabled && styles.disabledButton,
                ]}
                onPress={handleBiometricLogin}
                disabled={loginDisabled}
                activeOpacity={0.8}
              >
                {loginDisabled ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Icon source={biometricIconName} size={22} color="#FFFFFF" />
                    <Text style={styles.primaryButtonText}>
                      {biometricButtonLabel}
                    </Text>
                  </>
                )}
              </TouchableOpacity>

              {/* Sign in with different account */}
              <TouchableOpacity
                style={styles.switchButton}
                onPress={handleSwitchAccount}
                disabled={loginDisabled}
                activeOpacity={0.7}
              >
                <Icon source="account-switch-outline" size={18} color="#4B5563" />
                <Text style={styles.switchButtonText}>
                  Sign in with another account
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.authBox}>
              <View style={styles.welcomeBanner}>
                <Icon source="shield-lock-outline" size={34} color="#111111" />
                <Text style={styles.welcomeTitle}>Sign in to {APP_NAME}</Text>
                <Text style={styles.welcomeDescription}>
                  Access your encrypted personal cards, shared groups, and quick-fill assistant.
                </Text>
              </View>

              {/* Google Sign-In Button */}
              <TouchableOpacity
                style={[
                  styles.googleButton,
                  (loginDisabled || !isConnected) && styles.disabledButton,
                ]}
                onPress={signInWithGoogle}
                disabled={loginDisabled || !isConnected}
                activeOpacity={0.8}
              >
                {loginDisabled ? (
                  <ActivityIndicator size="small" color="#111111" />
                ) : (
                  <>
                    <Icon source="google" size={20} color="#EA4335" />
                    <Text style={styles.googleButtonText}>Continue with Google</Text>
                  </>
                )}
              </TouchableOpacity>

              {!isConnected && (
                <Text style={styles.offlineWarningText}>
                  Internet connection required to sign in.
                </Text>
              )}
            </View>
          )}
        </View>

        {/* Security Trust Footer */}
        <View style={styles.footer}>
          <Icon source="lock-check" size={14} color="#71717A" />
          <Text style={styles.footerText}>
            AES-256 Client Encryption • On-Device Biometrics
          </Text>
        </View>
      </ScrollView>

      <Snackbar
        visible={visible}
        onDismiss={onDismissSnackBar}
        action={{
          label: 'Dismiss',
          onPress: onDismissSnackBar,
        }}
      >
        {errorMessage}
      </Snackbar>
    </SafeAreaView>
  );
};

export default Login;

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F4F5F7',
  },
  scrollContainer: {
    flexGrow: 1,
    paddingHorizontal: 22,
    paddingTop: 36,
    paddingBottom: 28,
    justifyContent: 'center',
  },
  brandHeader: {
    alignItems: 'center',
    marginBottom: 28,
  },
  brandBox: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 10,
    elevation: 6,
  },
  brandTitle: {
    fontSize: 30,
    fontWeight: '800',
    color: '#111111',
    letterSpacing: -0.6,
    marginBottom: 4,
  },
  brandSubtitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#71717A',
    textAlign: 'center',
    marginBottom: 14,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusOnline: {
    backgroundColor: '#E6F4EA',
  },
  statusOffline: {
    backgroundColor: '#FEE2E2',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusDotOnline: {
    backgroundColor: '#1E7E34',
  },
  statusDotOffline: {
    backgroundColor: '#DC2626',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  statusTextOnline: {
    color: '#1E7E34',
  },
  statusTextOffline: {
    color: '#DC2626',
  },

  // Main Card
  cardContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 24,
    borderWidth: 1,
    borderColor: '#E4E4E7',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
    marginBottom: 24,
  },
  loadingBox: {
    paddingVertical: 36,
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: '#71717A',
    fontWeight: '500',
  },
  authBox: {
    width: '100%',
  },

  // Logged-in profile preview
  userProfileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 20,
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  userInfo: {
    flex: 1,
  },
  userEmailText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111111',
    marginBottom: 2,
  },
  activeSessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  activeSessionDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#F59E0B',
  },
  activeSessionText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#6B7280',
  },

  // Buttons
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111111',
    borderRadius: 14,
    paddingVertical: 15,
    paddingHorizontal: 20,
    gap: 10,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 6,
    elevation: 3,
    marginBottom: 12,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  switchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F4F5F7',
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#E4E4E7',
    gap: 8,
  },
  switchButtonText: {
    color: '#4B5563',
    fontSize: 13,
    fontWeight: '600',
  },

  // Signed-out State
  welcomeBanner: {
    alignItems: 'center',
    paddingVertical: 12,
    marginBottom: 18,
  },
  welcomeTitle: {
    fontSize: 19,
    fontWeight: '700',
    color: '#111111',
    marginTop: 8,
    marginBottom: 6,
  },
  welcomeDescription: {
    fontSize: 13,
    fontWeight: '400',
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 8,
  },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 15,
    paddingHorizontal: 20,
    borderWidth: 1.5,
    borderColor: '#D4D4D8',
    gap: 10,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  googleButtonText: {
    color: '#111111',
    fontSize: 15,
    fontWeight: '700',
  },
  disabledButton: {
    opacity: 0.6,
  },
  offlineWarningText: {
    fontSize: 12,
    color: '#DC2626',
    textAlign: 'center',
    marginTop: 10,
    fontWeight: '500',
  },

  // Footer
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingBottom: 8,
  },
  footerText: {
    fontSize: 12,
    color: '#71717A',
    fontWeight: '500',
  },
});
