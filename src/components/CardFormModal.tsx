import React, { useState, useEffect, useMemo, useRef, useContext } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Keyboard,
  Platform,
  useWindowDimensions,
  TouchableOpacity,
  FlatList,
} from 'react-native';
import { Alert } from './CustomAlert';
import {
  Modal,
  Portal,
  Text,
  Button,
  TextInput,
  HelperText,
  Menu,
  Icon,
  Searchbar,
} from 'react-native-paper';
import { isEmpty } from 'lodash';
import { Card } from '../types/Types';
import { BANK_COLORS, BANK_DICTIONARY, CARD_NETWORKS, CARD_TYPES } from '../constants/Constants';
import { formatCardNumber, detectCardNetwork, detectCardType } from '../util/Utils';
import { isNfcSupported, isNfcEnabled, goToNfcSettings, scanCardWithNfc, cancelNfcScan } from '../util/NfcCardReader';
import { ConnectivityContext } from '../util/Connectivity';

interface CardFormModalProps {
  visible: boolean;
  onDismiss: () => void;
  cardToEdit: Card | null;
  onSubmit: (card: Card) => Promise<void>;
}

const EMPTY_CARD: Card = {
  ownerName: '',
  bankName: '',
  number: '',
  month: '',
  year: '',
  cvv: '',
  name: '',
  limit: '',
  key: '',
  isPersonal: true,
  email: '',
  network: '',
  cardType: '',
};

const CardFormModal: React.FC<CardFormModalProps> = ({
  visible,
  onDismiss,
  cardToEdit,
  onSubmit,
}) => {
  const { isConnected } = useContext(ConnectivityContext);
  const { height: windowHeight } = useWindowDimensions();
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [formKey, setFormKey] = useState(0);
  const cardRef = useRef<Card>({ ...EMPTY_CARD });
  const [card, setCard] = useState<Card>(EMPTY_CARD);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [bankPickerVisible, setBankPickerVisible] = useState(false);
  const [bankSearchQuery, setBankSearchQuery] = useState('');
  const [networkMenuVisible, setNetworkMenuVisible] = useState(false);
  const [typeMenuVisible, setTypeMenuVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [nfcScanning, setNfcScanning] = useState(false);
  const [nfcStatusText, setNfcStatusText] = useState('');

  const isUpdate = Boolean(cardToEdit && cardToEdit.key);

  const filteredBankKeys = useMemo(() => {
    const q = bankSearchQuery.trim().toLowerCase();
    const allKeys = Object.keys(BANK_DICTIONARY);
    if (!q) {
      return allKeys;
    }
    return allKeys.filter(key => {
      const name = BANK_DICTIONARY[key]?.toLowerCase() || '';
      return name.includes(q) || key.toLowerCase().includes(q);
    });
  }, [bankSearchQuery]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, (e) => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    if (visible) {
      const initial = cardToEdit ? { ...cardToEdit } : { ...EMPTY_CARD };
      cardRef.current = initial;
      setCard(initial);
      setFormKey(k => k + 1);
      setTouched({});
      setBankPickerVisible(false);
      setBankSearchQuery('');
      setNetworkMenuVisible(false);
      setTypeMenuVisible(false);
      setSubmitting(false);
      setNfcScanning(false);
      setNfcStatusText('');
      setKeyboardHeight(0);
    }
  }, [visible, cardToEdit]);

  const openNetworkMenu = () => setNetworkMenuVisible(true);
  const closeNetworkMenu = () => setNetworkMenuVisible(false);

  const openTypeMenu = () => setTypeMenuVisible(true);
  const closeTypeMenu = () => setTypeMenuVisible(false);

  const handleBlur = (field: string) => {
    setTouched(prev => ({ ...prev, [field]: true }));
  };

  const stopNfcScan = async () => {
    setNfcScanning(false);
    setNfcStatusText('');
    await cancelNfcScan();
  };

  const handleNfcScan = async () => {
    if (!isConnected) {
      Alert.alert('Offline', 'You must be online to add or scan cards.');
      return;
    }
    try {
      const supported = await isNfcSupported();
      if (!supported) {
        Alert.alert('NFC Not Supported', 'Your device does not support NFC card scanning.');
        return;
      }
      const enabled = await isNfcEnabled();
      if (!enabled) {
        Alert.alert(
          'NFC Disabled',
          'Please enable NFC in your device settings to scan your contactless card.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => goToNfcSettings() },
          ],
        );
        return;
      }

      setNfcScanning(true);
      setNfcStatusText('Hold your card close to the back of your phone...');

      const scannedData = await scanCardWithNfc();

      const updated = {
        ...cardRef.current,
        ...(scannedData.cardNumber ? { number: formatCardNumber(scannedData.cardNumber) } : {}),
        ...(scannedData.expiryMonth ? { month: scannedData.expiryMonth } : {}),
        ...(scannedData.expiryYear ? { year: scannedData.expiryYear } : {}),
        ...(scannedData.ownerName ? { ownerName: scannedData.ownerName } : {}),
        ...(scannedData.cardName ? { name: scannedData.cardName } : {}),
        ...(scannedData.network ? { network: scannedData.network } : {}),
        ...(scannedData.cardType ? { cardType: scannedData.cardType } : {}),
      };
      cardRef.current = updated;
      setCard(updated);
      setFormKey(k => k + 1);
    } catch (e: any) {
      console.error('NFC scanning error:', e);
      const msg = e?.message || 'Could not read card via NFC. Please enter details manually.';
      if (!msg.toLowerCase().includes('cancel')) {
        Alert.alert('NFC Notice', msg);
      }
    } finally {
      setNfcScanning(false);
      setNfcStatusText('');
    }
  };

  const errors = useMemo(() => {
    const errs: Record<string, string> = {};

    if (isEmpty(card.ownerName.trim())) {
      errs.ownerName = 'Owner name is required';
    }
    if (isEmpty(card.bankName)) {
      errs.bankName = 'Please select bank name';
    }
    const cleanNumber = card.number.replace(/\D/g, '');
    const isDiners = cleanNumber.length === 14;
    const isAmex = cleanNumber.length === 15;
    const isStandard = cleanNumber.length === 16;

    if (isEmpty(card.number) || (!isDiners && !isAmex && !isStandard)) {
      errs.number = 'Card number must be 14 (Diners Club), 15 (Amex), or 16 digits';
    }
    if (isEmpty(card.month) || !/^(0[1-9]|1[0-2])$/.test(card.month) || card.month.length !== 2) {
      errs.month = 'Card month is empty or invalid';
    }
    const currentYearShort = new Date().getFullYear() % 100;
    if (isEmpty(card.year) || !/^\d{2}$/.test(card.year) || Number(card.year) < currentYearShort || card.year.length !== 2) {
      errs.year = 'Card year is empty or invalid';
    }
    // Allow any 3 or 4-digit CVV, including combinations with leading zeros (e.g. 002, 012, 000)
    if (isEmpty(card.cvv) || !/^\d{3,4}$/.test(card.cvv)) {
      errs.cvv = 'CVV is empty or invalid';
    }
    if (isEmpty(card.name.trim())) {
      errs.name = 'Card name cannot be empty';
    }
    if (isEmpty(card.limit) || !/^\d+$/.test(card.limit)) {
      errs.limit = 'Card limit is empty or invalid';
    }

    return errs;
  }, [card]);

  const isFormValid = useMemo(() => {
    return Object.keys(errors).length === 0;
  }, [errors]);

  const handleFormSubmit = async () => {
    if (!isConnected) {
      Alert.alert('Offline', 'You must be online to save or edit cards.');
      return;
    }
    if (!isFormValid || submitting) return;
    try {
      setSubmitting(true);
      await onSubmit({ ...cardRef.current });
    } catch (err) {
      console.error('Error submitting form:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const isKeyboardOpen = keyboardHeight > 0;

  const modalWrapperStyle = useMemo(() => {
    if (isKeyboardOpen) {
      return {
        justifyContent: 'flex-start' as const,
        paddingTop: Platform.OS === 'ios' ? 44 : 20,
      };
    }
    return {
      justifyContent: 'center' as const,
    };
  }, [isKeyboardOpen]);

  const modalContentStyle = useMemo(() => {
    if (isKeyboardOpen) {
      const topPadding = Platform.OS === 'ios' ? 44 : 20;
      const availableHeight = windowHeight - keyboardHeight - topPadding - 24;
      return [
        styles.containerStyle,
        {
          maxHeight: Math.max(availableHeight, 260),
          marginBottom: 10,
        },
      ];
    }
    return [
      styles.containerStyle,
      {
        maxHeight: windowHeight * 0.85,
        marginBottom: 20,
      },
    ];
  }, [isKeyboardOpen, windowHeight, keyboardHeight]);

  return (
    <Portal>
      <Modal
        visible={visible}
        onDismiss={onDismiss}
        style={modalWrapperStyle}
        contentContainerStyle={modalContentStyle}
      >
        <View style={styles.modalHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.modalTitle}>
              {isUpdate ? 'Edit Card' : 'Add New Card'}
            </Text>
            <Text style={styles.modalSubtitle}>
              {isUpdate ? 'Update your card details' : 'Save your card details securely'}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.closeModalBtn}
            onPress={onDismiss}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Icon source="close" size={20} color="#555555" />
          </TouchableOpacity>
        </View>

        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={true}
        >
          {!isConnected && (
            <View style={styles.offlineBanner}>
              <Icon source="cloud-off-outline" size={16} color="#B91C1C" />
              <Text style={styles.offlineBannerText}>You are offline. Adding or editing cards is disabled.</Text>
            </View>
          )}

          {!isUpdate && (
            <Button
              icon="nfc"
              mode="contained"
              onPress={handleNfcScan}
              disabled={!isConnected}
              style={[styles.nfcScanButton, !isConnected && { opacity: 0.5 }]}
              labelStyle={{ color: 'white', fontWeight: 'bold' }}
            >
              Scan with NFC (Tap card on phone)
            </Button>
          )}

          <View style={[styles.formElements, { marginBottom: 10 }]}>
            <TouchableOpacity
              style={[
                styles.bankSelectorButton,
                touched.bankName && errors.bankName && styles.bankSelectorButtonError,
              ]}
              onPress={() => setBankPickerVisible(true)}
              activeOpacity={0.8}
            >
              <View style={styles.bankSelectorLeft}>
                {card.bankName && BANK_COLORS[card.bankName] ? (
                  <View style={[styles.bankColorDot, { backgroundColor: BANK_COLORS[card.bankName] }]} />
                ) : (
                  <Icon source="bank" size={18} color="#888888" />
                )}
                <Text style={[styles.bankSelectorText, !card.bankName && styles.bankSelectorPlaceholder]}>
                  {BANK_DICTIONARY[card.bankName] ?? 'Select Bank'}
                </Text>
              </View>
              <Icon source="chevron-down" size={20} color="#888888" />
            </TouchableOpacity>
          </View>
          {touched.bankName && errors.bankName && (
            <HelperText type="error">
              {errors.bankName}
            </HelperText>
          )}

          <View style={[styles.row, { marginBottom: 10 }]}>
            <View style={styles.halfWidth}>
              <Menu
                contentStyle={styles.menuContent}
                visible={networkMenuVisible}
                onDismiss={closeNetworkMenu}
                anchor={
                  <TouchableOpacity
                    onPress={openNetworkMenu}
                    style={styles.pickerSelectorButton}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.pickerSelectorText,
                        !card.network && styles.pickerSelectorPlaceholder,
                      ]}
                      numberOfLines={1}
                    >
                      {CARD_NETWORKS[card.network || ''] ?? 'Network'}
                    </Text>
                    <Icon source="chevron-down" size={16} color="#888888" />
                  </TouchableOpacity>
                }
              >
                {Object.keys(CARD_NETWORKS).map((key) => (
                  <Menu.Item
                    onPress={() => {
                      cardRef.current.network = key;
                      setCard(prev => ({ ...prev, network: key }));
                      closeNetworkMenu();
                    }}
                    title={CARD_NETWORKS[key]}
                    key={key}
                  />
                ))}
              </Menu>
            </View>

            <View style={styles.halfWidth}>
              <Menu
                contentStyle={styles.menuContent}
                visible={typeMenuVisible}
                onDismiss={closeTypeMenu}
                anchor={
                  <TouchableOpacity
                    onPress={openTypeMenu}
                    style={styles.pickerSelectorButton}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.pickerSelectorText,
                        !card.cardType && styles.pickerSelectorPlaceholder,
                      ]}
                      numberOfLines={1}
                    >
                      {CARD_TYPES[card.cardType || ''] ?? 'Type'}
                    </Text>
                    <Icon source="chevron-down" size={16} color="#888888" />
                  </TouchableOpacity>
                }
              >
                {Object.keys(CARD_TYPES).map((key) => (
                  <Menu.Item
                    onPress={() => {
                      cardRef.current.cardType = key;
                      setCard(prev => ({ ...prev, cardType: key }));
                      closeTypeMenu();
                    }}
                    title={CARD_TYPES[key]}
                    key={key}
                  />
                ))}
              </Menu>
            </View>
          </View>

          <TextInput
            key={`ownerName-${formKey}`}
            label="Card owner name"
            defaultValue={card.ownerName}
            placeholder="Name printed on your card"
            onChangeText={text => {
              cardRef.current.ownerName = text;
              setCard(prev => ({ ...prev, ownerName: text }));
            }}
            autoCapitalize="words"
            autoCorrect={false}
            spellCheck={false}
            autoComplete="off"
            textContentType="none"
            mode="outlined"
            onBlur={() => handleBlur('ownerName')}
            style={styles.formElements}
          />
          {touched.ownerName && errors.ownerName && (
            <HelperText type="error">
              {errors.ownerName}
            </HelperText>
          )}

          <TextInput
            key={`number-${formKey}`}
            label="Card Number"
            value={card.number}
            placeholder="14, 15, or 16 digit card number"
            onChangeText={text => {
              const formatted = formatCardNumber(text);
              const detectedNet = detectCardNetwork(formatted);
              cardRef.current.number = formatted;
              setCard(prev => {
                const next = { ...prev, number: formatted };
                if (detectedNet && !prev.network) {
                  next.network = detectedNet;
                  cardRef.current.network = detectedNet;
                }
                return next;
              });
            }}
            maxLength={19}
            keyboardType="numeric"
            mode="outlined"
            onBlur={() => handleBlur('number')}
            style={styles.formElements}
          />
          {touched.number && errors.number && (
            <HelperText type="error">
              {errors.number}
            </HelperText>
          )}

          <View style={styles.row}>
            <View style={styles.halfWidth}>
              <TextInput
                key={`month-${formKey}`}
                label="Expiry month"
                placeholder="00"
                defaultValue={card.month}
                onChangeText={text => {
                  const cleaned = text.replace(/[^0-9]/g, '');
                  cardRef.current.month = cleaned;
                  setCard(prev => ({ ...prev, month: cleaned }));
                }}
                maxLength={2}
                keyboardType="numeric"
                mode="outlined"
                onBlur={() => handleBlur('month')}
                style={styles.formElements}
              />
              {touched.month && errors.month && (
                <HelperText type="error">
                  {errors.month}
                </HelperText>
              )}
            </View>

            <View style={styles.halfWidth}>
              <TextInput
                key={`year-${formKey}`}
                label="Expiry year"
                placeholder="00"
                defaultValue={card.year}
                onChangeText={text => {
                  const cleaned = text.replace(/[^0-9]/g, '');
                  cardRef.current.year = cleaned;
                  setCard(prev => ({ ...prev, year: cleaned }));
                }}
                maxLength={2}
                keyboardType="numeric"
                mode="outlined"
                onBlur={() => handleBlur('year')}
                style={styles.formElements}
              />
              {touched.year && errors.year && (
                <HelperText type="error">
                  {errors.year}
                </HelperText>
              )}
            </View>
          </View>

          <TextInput
            key={`cvv-${formKey}`}
            label="CVV / CID"
            placeholder="000 or 0000"
            defaultValue={card.cvv}
            onChangeText={text => {
              const cleaned = text.replace(/[^0-9]/g, '');
              cardRef.current.cvv = cleaned;
              setCard(prev => ({ ...prev, cvv: cleaned }));
            }}
            maxLength={4}
            keyboardType="numeric"
            mode="outlined"
            onBlur={() => handleBlur('cvv')}
            style={styles.formElements}
          />
          {touched.cvv && errors.cvv && (
            <HelperText type="error">
              {errors.cvv}
            </HelperText>
          )}

          <TextInput
            key={`name-${formKey}`}
            style={styles.formElements}
            label="Card name"
            placeholder="Type/name of card"
            defaultValue={card.name}
            onChangeText={text => {
              cardRef.current.name = text;
              setCard(prev => ({ ...prev, name: text }));
            }}
            autoCapitalize="words"
            autoCorrect={false}
            spellCheck={false}
            autoComplete="off"
            textContentType="none"
            mode="outlined"
            onBlur={() => handleBlur('name')}
          />
          {touched.name && errors.name && (
            <HelperText type="error">
              {errors.name}
            </HelperText>
          )}

          <TextInput
            key={`limit-${formKey}`}
            label="Limit"
            placeholder="Your credit card limit"
            defaultValue={card.limit}
            onChangeText={text => {
              const cleaned = text.replace(/[^0-9]/g, '');
              cardRef.current.limit = cleaned;
              setCard(prev => ({ ...prev, limit: cleaned }));
            }}
            maxLength={12}
            keyboardType="numeric"
            mode="outlined"
            onBlur={() => handleBlur('limit')}
            style={styles.formElements}
          />
          {touched.limit && errors.limit && (
            <HelperText type="error">
              {errors.limit}
            </HelperText>
          )}

          <Button
            icon={isUpdate ? 'check-circle-outline' : 'plus-circle-outline'}
            mode="contained"
            onPress={handleFormSubmit}
            disabled={!isFormValid || submitting || !isConnected}
            loading={submitting}
            style={[styles.button, isFormValid && !submitting && isConnected && styles.buttonActive]}
            labelStyle={styles.buttonLabel}
          >
            {!isConnected
              ? 'Offline (Cannot save)'
              : isUpdate
              ? 'Update Card'
              : 'Save Card'}
          </Button>
        </ScrollView>
      </Modal>

      <Modal
        visible={nfcScanning}
        onDismiss={stopNfcScan}
        contentContainerStyle={styles.nfcModalContent}
      >
        <View style={{ alignItems: 'center', padding: 10 }}>
          <Icon source="nfc" size={64} color="#0066cc" />
          <Text variant="headlineSmall" style={styles.nfcModalTitle}>
            Ready to Scan
          </Text>
          <Text style={styles.nfcModalDescription}>
            Hold your contactless credit/debit card firmly near the back of your phone.
          </Text>
          {nfcStatusText ? (
            <Text style={styles.nfcStatus}>{nfcStatusText}</Text>
          ) : null}
          <Button mode="outlined" onPress={stopNfcScan} style={{ marginTop: 24, width: '80%' }}>
            Cancel
          </Button>
        </View>
      </Modal>

      {/* Searchable Bank Picker Modal */}
      <Modal
        visible={bankPickerVisible}
        onDismiss={() => {
          setBankPickerVisible(false);
          setBankSearchQuery('');
        }}
        contentContainerStyle={styles.bankPickerModal}
      >
        <View style={styles.bankPickerHeader}>
          <Text style={styles.bankPickerTitle} variant="titleLarge">
            Select Bank
          </Text>
          <TouchableOpacity
            onPress={() => {
              setBankPickerVisible(false);
              setBankSearchQuery('');
            }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Icon source="close" size={22} color="#333333" />
          </TouchableOpacity>
        </View>

        <Searchbar
          placeholder="Search bank (e.g. HDFC, SBI)..."
          value={bankSearchQuery}
          onChangeText={setBankSearchQuery}
          style={styles.bankSearchBar}
          inputStyle={styles.bankSearchInput}
          iconColor="#666666"
          autoCapitalize="none"
        />

        <FlatList
          data={filteredBankKeys}
          keyExtractor={item => item}
          keyboardShouldPersistTaps="handled"
          style={styles.bankList}
          contentContainerStyle={styles.bankListContent}
          renderItem={({ item }) => {
            const isSelected = card.bankName === item;
            const name = BANK_DICTIONARY[item];
            const color = BANK_COLORS[item] || '#333333';

            return (
              <TouchableOpacity
                style={[styles.bankItemRow, isSelected && styles.bankItemRowSelected]}
                onPress={() => {
                  cardRef.current.bankName = item;
                  setCard(prev => ({ ...prev, bankName: item }));
                  setBankPickerVisible(false);
                  setBankSearchQuery('');
                }}
                activeOpacity={0.7}
              >
                <View style={[styles.bankItemDot, { backgroundColor: color }]} />
                <Text style={[styles.bankItemText, isSelected && styles.bankItemTextSelected]}>
                  {name}
                </Text>
                {isSelected && (
                  <Icon source="check-circle" size={20} color="#0033A0" />
                )}
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <View style={styles.bankEmptyContainer}>
              <Icon source="magnify-close" size={36} color="#999999" />
              <Text style={styles.bankEmptyText}>
                No bank found matching "{bankSearchQuery}"
              </Text>
            </View>
          }
        />
      </Modal>
    </Portal>
  );
};

export default CardFormModal;

const styles = StyleSheet.create({
  containerStyle: {
    backgroundColor: '#F8F9FA',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 10,
    marginHorizontal: 12,
    borderRadius: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111111',
  },
  modalSubtitle: {
    fontSize: 12,
    color: '#666666',
    marginTop: 2,
  },
  closeModalBtn: {
    padding: 4,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderWidth: 1,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  offlineBannerText: {
    fontSize: 12,
    color: '#B91C1C',
    fontWeight: '600',
    flex: 1,
  },
  modelTitle: {
    fontSize: 20,
    alignSelf: 'center',
    marginBottom: 8,
  },
  scrollContent: {
    paddingBottom: 24,
    flexGrow: 1,
  },
  formElements: {
    marginVertical: 4,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  halfWidth: {
    flex: 1,
  },
  pickerSelectorButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1E1E1E',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    width: '100%',
  },
  pickerSelectorText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  pickerSelectorPlaceholder: {
    color: '#AAAAAA',
    fontWeight: 'normal',
  },
  menuContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
  },
  dropDownButton: {
    backgroundColor: '#1E1E1E',
    borderRadius: 8,
    width: '100%',
  },
  button: {
    marginTop: 16,
    marginBottom: 8,
    backgroundColor: '#6B7280',
    borderRadius: 8,
    paddingVertical: 2,
  },
  buttonActive: {
    backgroundColor: '#000000',
  },
  buttonLabel: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  nfcScanButton: {
    backgroundColor: '#0066cc',
    marginBottom: 12,
    borderRadius: 8,
  },
  nfcModalContent: {
    backgroundColor: 'white',
    padding: 24,
    marginHorizontal: 24,
    borderRadius: 16,
    alignItems: 'center',
  },
  nfcModalTitle: {
    marginTop: 12,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  nfcModalDescription: {
    marginTop: 8,
    textAlign: 'center',
    color: '#666',
  },
  nfcStatus: {
    marginTop: 12,
    textAlign: 'center',
    color: '#0066cc',
    fontWeight: '500',
  },
  bankSelectorButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#000000',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  bankSelectorButtonError: {
    borderWidth: 1,
    borderColor: '#B00020',
  },
  bankSelectorLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  bankColorDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    marginRight: 10,
  },
  bankSelectorText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  bankSelectorPlaceholder: {
    color: '#AAAAAA',
    fontWeight: 'normal',
  },
  bankPickerModal: {
    backgroundColor: '#F8F9FA',
    marginHorizontal: 16,
    borderRadius: 16,
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 8,
    maxHeight: '85%',
  },
  bankPickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  bankPickerTitle: {
    fontWeight: 'bold',
    color: '#111111',
    fontSize: 18,
  },
  bankSearchBar: {
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    marginBottom: 10,
    elevation: 0,
    height: 44,
  },
  bankSearchInput: {
    minHeight: 44,
    fontSize: 14,
  },
  bankList: {
    maxHeight: 360,
  },
  bankListContent: {
    paddingBottom: 16,
  },
  bankItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: 10,
    borderRadius: 8,
    marginBottom: 2,
  },
  bankItemRowSelected: {
    backgroundColor: '#EEF2FF',
  },
  bankItemDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 12,
  },
  bankItemText: {
    flex: 1,
    fontSize: 15,
    color: '#222222',
  },
  bankItemTextSelected: {
    fontWeight: 'bold',
    color: '#0033A0',
  },
  bankEmptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 28,
  },
  bankEmptyText: {
    color: '#888888',
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
});
