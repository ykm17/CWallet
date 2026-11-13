import React, { useState, useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet, ScrollView, Alert } from 'react-native';
import { Modal, Portal, Text, Button, TextInput, HelperText, Menu, Switch, Icon } from 'react-native-paper';
import { isEmpty } from 'lodash';
import { Card } from '../types/Types';
import { BANK_DICTIONARY } from '../constants/Constants';
import { formatCardNumber } from '../util/Utils';
import { isNfcSupported, isNfcEnabled, goToNfcSettings, scanCardWithNfc, cancelNfcScan } from '../util/NfcCardReader';

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
};

const CardFormModal: React.FC<CardFormModalProps> = ({
  visible,
  onDismiss,
  cardToEdit,
  onSubmit,
}) => {
  const [formKey, setFormKey] = useState(0);
  const cardRef = useRef<Card>({ ...EMPTY_CARD });
  const [card, setCard] = useState<Card>(EMPTY_CARD);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [dropDownVisible, setDropDownVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [nfcScanning, setNfcScanning] = useState(false);
  const [nfcStatusText, setNfcStatusText] = useState('');

  const isUpdate = Boolean(cardToEdit && cardToEdit.key);

  useEffect(() => {
    if (visible) {
      const initial = cardToEdit ? { ...cardToEdit } : { ...EMPTY_CARD };
      cardRef.current = initial;
      setCard(initial);
      setFormKey(k => k + 1);
      setTouched({});
      setDropDownVisible(false);
      setSubmitting(false);
      setNfcScanning(false);
      setNfcStatusText('');
    }
  }, [visible, cardToEdit]);

  const openMenu = () => setDropDownVisible(true);
  const closeMenu = () => setDropDownVisible(false);

  const handleBlur = (field: string) => {
    setTouched(prev => ({ ...prev, [field]: true }));
  };

  const stopNfcScan = async () => {
    setNfcScanning(false);
    setNfcStatusText('');
    await cancelNfcScan();
  };

  const handleNfcScan = async () => {
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
        ...(scannedData.bankName ? { bankName: scannedData.bankName } : {}),
        ...(scannedData.cardName ? { name: scannedData.cardName } : {}),
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
    if (isEmpty(card.number) || !/^(\d{4}\s?){3}\d{4}$/.test(card.number) || card.number.length !== 19) {
      errs.number = 'Card number is empty or invalid';
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

  return (
    <Portal>
      <Modal visible={visible} onDismiss={onDismiss} contentContainerStyle={styles.containerStyle}>
        <Text style={styles.modelTitle} variant="headlineMedium">
          {`${isUpdate ? 'Update your' : 'Add new'} card.`}
        </Text>

        {!isUpdate && (
          <Button
            icon="nfc"
            mode="contained"
            onPress={handleNfcScan}
            style={styles.nfcScanButton}
            labelStyle={{ color: 'white', fontWeight: 'bold' }}
          >
            Scan with NFC (Tap card on phone)
          </Button>
        )}

        <ScrollView keyboardShouldPersistTaps="handled">
          <View style={[styles.formElements, { marginBottom: 10 }]}>
            <Menu
              contentStyle={{ backgroundColor: 'white' }}
              visible={dropDownVisible}
              onDismiss={closeMenu}
              anchor={
                <Button onPress={openMenu} style={styles.dropDownButton} labelStyle={{ color: 'white', width: '100%' }}>
                  {BANK_DICTIONARY[card.bankName] ?? 'Select Bank'}
                </Button>
              }
            >
              {Object.keys(BANK_DICTIONARY).map((item, index) => (
                <Menu.Item
                  onPress={() => {
                    cardRef.current.bankName = item;
                    setCard(prev => ({ ...prev, bankName: item }));
                    closeMenu();
                  }}
                  title={BANK_DICTIONARY[item]}
                  key={index}
                />
              ))}
            </Menu>
          </View>
          {touched.bankName && errors.bankName && (
            <HelperText type="error">
              {errors.bankName}
            </HelperText>
          )}

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
            placeholder="0000 0000 0000 0000"
            onChangeText={text => {
              const formatted = formatCardNumber(text);
              cardRef.current.number = formatted;
              setCard(prev => ({ ...prev, number: formatted }));
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
            label="CVV"
            placeholder="000"
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

          <View style={{ flexDirection: 'row', alignSelf: 'flex-end', alignItems: 'center', marginVertical: 8 }}>
            <Text style={{ fontWeight: 'bold' }}>Share with group</Text>
            <Switch
              value={!card.isPersonal}
              onValueChange={val => {
                cardRef.current.isPersonal = !val;
                setCard(prev => ({ ...prev, isPersonal: !val }));
              }}
              style={{ marginStart: 10 }}
            />
          </View>

          <Button
            icon="send-circle"
            mode="contained"
            onPress={handleFormSubmit}
            disabled={!isFormValid || submitting}
            loading={submitting}
            style={styles.button}
          >
            Submit
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
    </Portal>
  );
};

export default CardFormModal;

const styles = StyleSheet.create({
  containerStyle: {
    backgroundColor: 'white',
    padding: 20,
    marginHorizontal: 10,
    marginBottom: 40,
    marginTop: 10,
    borderRadius: 10,
    maxHeight: '90%',
  },
  modelTitle: {
    fontSize: 22,
    alignSelf: 'center',
    marginBottom: 10,
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
  dropDownButton: {
    backgroundColor: '#6750a4',
    borderRadius: 5,
    width: '100%',
  },
  button: {
    marginTop: 16,
    marginBottom: 8,
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
});
