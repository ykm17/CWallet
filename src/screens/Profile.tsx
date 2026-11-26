import React, { useState, useEffect, useCallback, useContext } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Switch,
  Image,
  Platform,
  AppState,
  BackHandler,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../App';
import auth from '@react-native-firebase/auth';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { Icon, Dialog, Portal } from 'react-native-paper';
import Clipboard from '@react-native-clipboard/clipboard';
import { APP_NAME } from '../constants/Constants';
import {
  isOverlayFeatureEnabled,
  setOverlayFeatureEnabled,
  canDrawOverlays,
  requestOverlayPermission,
} from '../services/cardOverlayService';
import { ConnectivityContext } from '../util/Connectivity';
import EncryptedStorage from 'react-native-encrypted-storage';

type Props = NativeStackScreenProps<RootStackParamList, 'Profile'>;

const Profile: React.FC<Props> = ({ navigation }) => {
  const currentUser = auth().currentUser;
  const { isConnected } = useContext(ConnectivityContext);

  const [overlayEnabled, setOverlayEnabled] = useState(true);
  const [hasOverlayPermission, setHasOverlayPermission] = useState(true);
  const [logoutDialogVisible, setLogoutDialogVisible] = useState(false);
  const [copiedUid, setCopiedUid] = useState(false);

  // Load preferences and permission status
  const loadPreferences = useCallback(async () => {
    try {
      const enabled = await isOverlayFeatureEnabled();
      setOverlayEnabled(enabled);

      if (Platform.OS === 'android') {
        const canDraw = await canDrawOverlays();
        setHasOverlayPermission(canDraw);
      } else {
        setHasOverlayPermission(true);
      }
    } catch (e) {
      console.log('Error loading profile preferences:', e);
    }
  }, []);

  useEffect(() => {
    loadPreferences();

    // Re-check permissions on app resume (e.g., returning from system settings)
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        loadPreferences();
      }
    });

    return () => sub.remove();
  }, [loadPreferences]);

  useEffect(() => {
    const onBackPress = () => {
      if (logoutDialogVisible) {
        setLogoutDialogVisible(false);
        return true;
      }
      return false;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [logoutDialogVisible]);

  const handleToggleOverlay = async (value: boolean) => {
    setOverlayEnabled(value);
    await setOverlayFeatureEnabled(value);

    // If enabled on Android and missing system permission, prompt to open settings
    if (value && Platform.OS === 'android') {
      const canDraw = await canDrawOverlays();
      setHasOverlayPermission(canDraw);
      if (!canDraw) {
        requestOverlayPermission();
      }
    }
  };

  const handleCopyUid = () => {
    if (currentUser?.uid) {
      Clipboard.setString(currentUser.uid);
      setCopiedUid(true);
      setTimeout(() => setCopiedUid(false), 2000);
    }
  };

  const handleSignOut = async () => {
    try {
      setLogoutDialogVisible(false);
      await auth().signOut();
      try {
        await GoogleSignin.signOut();
      } catch (_) {}
      await Promise.allSettled([
        EncryptedStorage.removeItem('cwallet_auth_user'),
        EncryptedStorage.removeItem('cards'),
        EncryptedStorage.removeItem('shared_cards'),
      ]);
      navigation.reset({
        index: 0,
        routes: [{ name: 'Login' }],
      });
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  const displayName = currentUser?.displayName || 'EWallet User';
  const email = currentUser?.email || 'No email associated';
  const photoUrl = currentUser?.photoURL;
  const initial = (displayName.charAt(0) || email.charAt(0) || 'U').toUpperCase();

  const formattedCreationDate = currentUser?.metadata?.creationTime
    ? new Date(currentUser.metadata.creationTime).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : null;

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* User Card */}
        <View style={styles.userCard}>
          <View style={styles.avatarWrap}>
            {photoUrl ? (
              <Image source={{ uri: photoUrl }} style={styles.avatarImage} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarInitial}>{initial}</Text>
              </View>
            )}
            <View style={styles.verifiedDot}>
              <Icon source="check" size={12} color="#FFFFFF" />
            </View>
          </View>

          <Text style={styles.userName}>{displayName}</Text>
          <Text style={styles.userEmail}>{email}</Text>

          <View style={styles.badgeRow}>
            <View style={styles.verifiedBadge}>
              <Icon source="shield-check" size={14} color="#15803D" />
              <Text style={styles.verifiedBadgeText}>Verified Account</Text>
            </View>
            <View
              style={[
                styles.statusBadge,
                isConnected ? styles.statusBadgeOnline : styles.statusBadgeOffline,
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
                  styles.statusBadgeText,
                  isConnected ? styles.statusBadgeTextOnline : styles.statusBadgeTextOffline,
                ]}
              >
                {isConnected ? 'Online' : 'Offline'}
              </Text>
            </View>
          </View>
        </View>

        {/* Preferences Section: Overlay Popup */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionHeader}>PREFERENCES</Text>

          <View style={styles.settingRow}>
            <View style={styles.settingIconBox}>
              <Icon source="card-multiple-outline" size={20} color="#111111" />
            </View>
            <View style={styles.settingContent}>
              <Text style={styles.settingTitle}>Floating Card Assistant</Text>
              <Text style={styles.settingDesc}>
                Show floating overlay with expiry and CVV when copying card numbers
              </Text>
            </View>
            <Switch
              value={overlayEnabled}
              onValueChange={handleToggleOverlay}
              trackColor={{ false: '#E4E4E7', true: '#111111' }}
              thumbColor="#FFFFFF"
            />
          </View>

          {/* Android Permission Warning if enabled but permission missing */}
          {overlayEnabled && Platform.OS === 'android' && !hasOverlayPermission && (
            <View style={styles.warningBox}>
              <Icon source="alert-circle-outline" size={18} color="#D97706" />
              <View style={styles.warningContent}>
                <Text style={styles.warningText}>
                  "Display over other apps" permission is required for the floating assistant.
                </Text>
                <TouchableOpacity
                  style={styles.openSettingsBtn}
                  onPress={requestOverlayPermission}
                  activeOpacity={0.7}
                >
                  <Text style={styles.openSettingsText}>Grant Permission</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        {/* Account Details Section */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionHeader}>ACCOUNT DETAILS</Text>

          {/* Provider */}
          <View style={styles.infoRow}>
            <View style={styles.infoIconBox}>
              <Icon source="google" size={18} color="#EA4335" />
            </View>
            <View style={styles.infoContent}>
              <Text style={styles.infoLabel}>Sign-in Provider</Text>
              <Text style={styles.infoValue}>Google Authentication</Text>
            </View>
          </View>

          <View style={styles.divider} />

          {/* User ID */}
          <View style={styles.infoRow}>
            <View style={styles.infoIconBox}>
              <Icon source="identifier" size={18} color="#111111" />
            </View>
            <View style={styles.infoContent}>
              <Text style={styles.infoLabel}>User ID</Text>
              <Text style={styles.infoValue} numberOfLines={1}>
                {currentUser?.uid || 'Unknown'}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.copyBtn}
              onPress={handleCopyUid}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Icon
                source={copiedUid ? 'check' : 'content-copy'}
                size={16}
                color={copiedUid ? '#15803D' : '#6B7280'}
              />
              <Text style={[styles.copyBtnText, copiedUid && styles.copyBtnTextSuccess]}>
                {copiedUid ? 'Copied' : 'Copy'}
              </Text>
            </TouchableOpacity>
          </View>

          {formattedCreationDate && (
            <>
              <View style={styles.divider} />
              <View style={styles.infoRow}>
                <View style={styles.infoIconBox}>
                  <Icon source="calendar-month-outline" size={18} color="#111111" />
                </View>
                <View style={styles.infoContent}>
                  <Text style={styles.infoLabel}>Member Since</Text>
                  <Text style={styles.infoValue}>{formattedCreationDate}</Text>
                </View>
              </View>
            </>
          )}
        </View>

        {/* Security & System Info Section */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionHeader}>SECURITY & VAULT</Text>

          <View style={styles.infoRow}>
            <View style={styles.infoIconBox}>
              <Icon source="lock-check" size={18} color="#15803D" />
            </View>
            <View style={styles.infoContent}>
              <Text style={styles.infoLabel}>Card Storage Encryption</Text>
              <Text style={styles.infoValue}>AES-256 Client Encryption</Text>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.infoRow}>
            <View style={styles.infoIconBox}>
              <Icon source="fingerprint" size={18} color="#111111" />
            </View>
            <View style={styles.infoContent}>
              <Text style={styles.infoLabel}>Biometric Protection</Text>
              <Text style={styles.infoValue}>Enabled on this device</Text>
            </View>
          </View>
        </View>

        {/* Log Out Button */}
        <TouchableOpacity
          style={styles.logoutButton}
          onPress={() => setLogoutDialogVisible(true)}
          activeOpacity={0.8}
        >
          <Icon source="logout" size={20} color="#DC2626" />
          <Text style={styles.logoutButtonText}>Log Out</Text>
        </TouchableOpacity>

        <Text style={styles.versionText}>{APP_NAME} • Version 0.0.1</Text>
      </ScrollView>

      {/* Logout Confirmation Dialog */}
      <Portal>
        <Dialog
          visible={logoutDialogVisible}
          onDismiss={() => setLogoutDialogVisible(false)}
          style={styles.confirmDialog}
        >
          <View style={styles.confirmDialogContent}>
            <View style={styles.confirmHeader}>
              <View style={styles.confirmIconContainer}>
                <Icon source="logout" size={20} color="#DC2626" />
              </View>
              <Text style={styles.confirmDialogTitle}>Log Out</Text>
            </View>
            <Text style={styles.confirmDialogMessage}>
              Are you sure you want to log out of {APP_NAME}? You will need to sign in again to
              access your cards.
            </Text>
            <View style={styles.confirmDialogActions}>
              <TouchableOpacity
                style={styles.confirmCancelBtn}
                onPress={() => setLogoutDialogVisible(false)}
                activeOpacity={0.7}
              >
                <Text style={styles.confirmCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.confirmActionBtn}
                onPress={handleSignOut}
                activeOpacity={0.7}
              >
                <Text style={styles.confirmActionText}>Log Out</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Dialog>
      </Portal>
    </SafeAreaView>
  );
};

export default Profile;

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F4F5F7',
  },
  scrollContainer: {
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 36,
  },

  // User Header Card
  userCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 22,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E4E4E7',
    marginBottom: 16,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  avatarWrap: {
    position: 'relative',
    marginBottom: 14,
  },
  avatarImage: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 2,
    borderColor: '#111111',
  },
  avatarPlaceholder: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '800',
  },
  verifiedDot: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#16A34A',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  userName: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111111',
    letterSpacing: -0.4,
    marginBottom: 4,
  },
  userEmail: {
    fontSize: 14,
    fontWeight: '500',
    color: '#71717A',
    marginBottom: 12,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  verifiedBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#15803D',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusBadgeOnline: {
    backgroundColor: '#E6F4EA',
  },
  statusBadgeOffline: {
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
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  statusBadgeTextOnline: {
    color: '#1E7E34',
  },
  statusBadgeTextOffline: {
    color: '#DC2626',
  },

  // Sections
  sectionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E4E4E7',
    marginBottom: 16,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 1,
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: '800',
    color: '#71717A',
    letterSpacing: 0.8,
    marginBottom: 14,
  },

  // Setting Row (Switch)
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  settingIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#F4F5F7',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  settingContent: {
    flex: 1,
    marginRight: 10,
  },
  settingTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111111',
    marginBottom: 2,
  },
  settingDesc: {
    fontSize: 12,
    color: '#6B7280',
    lineHeight: 16,
  },

  // Warning Box
  warningBox: {
    flexDirection: 'row',
    backgroundColor: '#FEF3C7',
    borderRadius: 12,
    padding: 12,
    marginTop: 14,
    gap: 10,
    alignItems: 'flex-start',
  },
  warningContent: {
    flex: 1,
  },
  warningText: {
    fontSize: 12,
    color: '#92400E',
    lineHeight: 16,
    marginBottom: 8,
    fontWeight: '500',
  },
  openSettingsBtn: {
    alignSelf: 'flex-start',
    backgroundColor: '#D97706',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
  },
  openSettingsText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },

  // Info Row
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  infoIconBox: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: '#F4F5F7',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  infoContent: {
    flex: 1,
    marginRight: 8,
  },
  infoLabel: {
    fontSize: 12,
    color: '#71717A',
    fontWeight: '500',
    marginBottom: 2,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111111',
  },
  divider: {
    height: 1,
    backgroundColor: '#F3F4F6',
    marginVertical: 12,
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F4F5F7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  copyBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#4B5563',
  },
  copyBtnTextSuccess: {
    color: '#15803D',
  },

  // Logout Button
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 20,
    gap: 8,
    marginTop: 4,
    marginBottom: 16,
  },
  logoutButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#DC2626',
  },
  versionText: {
    fontSize: 12,
    color: '#A1A1AA',
    textAlign: 'center',
    fontWeight: '500',
  },

  // Logout Dialog
  confirmDialog: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    marginHorizontal: 28,
  },
  confirmDialogContent: {
    padding: 20,
  },
  confirmHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  confirmIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmDialogTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111111',
  },
  confirmDialogMessage: {
    fontSize: 14,
    color: '#6B7280',
    lineHeight: 20,
    marginBottom: 20,
  },
  confirmDialogActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  confirmCancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
  },
  confirmCancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
  confirmActionBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#DC2626',
  },
  confirmActionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});

