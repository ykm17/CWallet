import { View, SafeAreaView, StyleSheet, TouchableOpacity, ScrollView, BackHandler } from 'react-native'
import React, { useEffect, useState } from 'react'
import CustomCard from '../components/CustomCard';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../App';
import auth from '@react-native-firebase/auth';
import { FlatList } from 'react-native';
import { Card } from '../types/Types';
import { FAB, Modal, Portal, Text, Button, PaperProvider, TextInput, HelperText, Menu, Divider } from 'react-native-paper';
import { isEmpty } from 'lodash';
import { BANK_DICTIONARY, ENV } from '../constants/Constants';
import database from '@react-native-firebase/database';
import { formatCardNumber } from '../util/Utils';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

const Home: React.FC<Props> = ({ navigation }) => {
  const reference = database().ref(ENV + '/cards');

  const [modalVisible, setModalVisible] = useState(false);
  //Modal input fields
  const [cardOwnerName, setCardOwnerName] = useState("");
  const [cardBankName, setCardBankName] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [cardMonth, setCardMonth] = useState("");
  const [cardYear, setCardYear] = useState("");
  const [cardCvv, setCardCvv] = useState("");
  const [cardName, setCardName] = useState("");
  const [cardLimit, setCardLimit] = useState("");
  const [isFormValid, setIsFormValid] = useState(false);
  const [dropDownVisible, setDropDownVisible] = React.useState(false);
  const [cardData, setCardData] = useState<Card[]>([]);
  const [errors, setErrors] = useState<Card>({
    ownerName: '',
    bankName: '',
    number: '',
    month: '',
    year: '',
    cvv: '',
    name: '',
    limit: ''
  });
  const [touched, setTouched] = useState<Card>({
    ownerName: '',
    bankName: '',
    number: '',
    month: '',
    year: '',
    cvv: '',
    name: '',
    limit: ''
  });
  const openMenu = () => setDropDownVisible(true);
  const closeMenu = () => setDropDownVisible(false);
  const showModal = () => setModalVisible(true);
  const hideModal = () => {
    setModalVisible(false);
    setCardOwnerName("");
    setCardBankName("");
    setCardNumber("");
    setCardMonth("");
    setCardYear("");
    setCardCvv("");
    setCardName("");
    setCardLimit("");
    setTouched({
      ownerName: '',
      bankName: '',
      number: '',
      month: '',
      year: '',
      cvv: '',
      name: '',
      limit: ''
    });  // Reset touched fields

  }

  useEffect(() => {
    validateForm();
  }, [cardOwnerName, cardBankName, cardNumber, cardMonth, cardYear, cardCvv, cardName, cardLimit]);

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => <TouchableOpacity onPress={signOutUser}><Text style={{ color: 'black' }}>Logout</Text></TouchableOpacity>,
    });
  }, []);

  useEffect(() => {
    const onValueChange = reference.on('value', (snapshot) => {
      const data = snapshot.val(); // Get the data from snapshot
      if (data) {
        setCardData(Object.values(data) as Card[] ?? []); // Convert to array if needed
        console.log(Object.values(data));
      } else {
        setCardData([]);
      }
    });

    const onChildRemoved = reference.on('child_removed', (snapshot) => {
      const data = snapshot.val(); // Get the data from snapshot
      if (data) {
        setCardData(Object.values(data) as Card[] ?? []); // Convert to array if needed
        console.log(Object.values(data));
      } else {
        setCardData([]);
      }
    });
    //return () => reference.off('value', onValueChange);
  }, []);


  const signOutUser = async () => {
    try {
      // Sign out from Firebase
      await auth().signOut();
      // Sign out from Google
      await GoogleSignin.signOut();
      navigation.replace('Login');
      console.log('User signed out from Firebase and Google');
    } catch (error) {
      console.error('Sign-out Error:', error);
    }
  };

  const validateForm = () => {
    let validationErrors: Card = {
      ownerName: '',
      bankName: '',
      number: '',
      month: '',
      year: '',
      cvv: '',
      name: '',
      limit: ''
    };

    if (isEmpty(cardOwnerName)) {
      validationErrors.ownerName = "Owner name is required";
    }
    if (isEmpty(cardBankName)) {
      validationErrors.bankName = "Please select bank name";
    }
    if (isEmpty(cardNumber) || !/^(\d{4}\s?){3}\d{4}$/.test(cardNumber) || cardNumber.length !== 19) {
      validationErrors.number = "Card number is empty or invalid";
    }
    if (isEmpty(cardMonth) || !/^(0[1-9]|1[0-2])$/.test(cardMonth) || cardMonth.length !== 2) {
      validationErrors.month = "Card month is empty or invalid";
    }
    if (isEmpty(cardYear) || !/^(?:[1-9]|[1-9][0-9])$/.test(cardYear) || cardYear.length !== 2) {
      validationErrors.year = "Card year is empty or invalid";
    }
    if (isEmpty(cardCvv) || !/^(?!0)([1-9][0-9]{0,2})$/.test(cardCvv) || cardCvv.length !== 3) {
      validationErrors.cvv = "CVV is empty or invalid";
    }
    if (isEmpty(cardName)) {
      validationErrors.name = "Card name cannot be empty";
    }
    if (isEmpty(cardLimit) || !/^\d+$/.test(cardLimit)) {
      validationErrors.limit = "Card limit is empty or invalid";
    }

    setErrors(validationErrors);
    setIsFormValid(Object.values(validationErrors).every(value => value == ''));
  };

  const handleSubmit = () => {
    if (isFormValid) {

      // Form is valid, perform the submission logic
      console.log('Form submitted successfully!');
      reference
        .push({
          ownerName: cardOwnerName,
          bankName: cardBankName,
          number: cardNumber,
          month: cardMonth,
          year: cardYear,
          cvv: cardCvv,
          name: cardName,
          limit: cardLimit,
        });
      hideModal();
      setCardOwnerName("");
      setCardBankName("");
      setCardNumber("");
      setCardMonth("");
      setCardYear("");
      setCardCvv("");
      setCardName("");
      setCardLimit("");
      setTouched({
        ownerName: '',
        bankName: '',
        number: '',
        month: '',
        year: '',
        cvv: '',
        name: '',
        limit: ''
      });  // Reset touched fields
      //.then(() => console.log('Data submitted'));

    } else {
      // Form is invalid, display error messages
      console.log('Form has errors. Please correct them.');
    }
  };

  const handleBlur = (field: keyof Card) => {
    setTouched((prevState) => ({ ...prevState, [field]: true }));
  };

  return (
    <SafeAreaView style={styles.mainContainer}>
      <View style={{ flex: 1 }}>
        <Portal>
          <Modal visible={modalVisible} onDismiss={hideModal} contentContainerStyle={styles.containerStyle}>
            <Text style={styles.modelTitle} variant="headlineMedium">Fill details to add new card !</Text>
            <ScrollView>
              <View style={styles.formElements} >
                <Menu
                  contentStyle={{ backgroundColor: 'white' }}
                  visible={dropDownVisible}
                  onDismiss={closeMenu}
                  anchor={<Button onPress={openMenu} style={styles.dropDownButton} labelStyle={{ color: 'white', width: '100%' }}>{BANK_DICTIONARY[cardBankName] ?? "Select Bank"}</Button>}>
                  {
                    Object.keys(BANK_DICTIONARY).map((item, index) => (
                      <Menu.Item onPress={() => (setCardBankName(item), closeMenu())} title={BANK_DICTIONARY[item]} key={index} />
                    ))
                  }
                </Menu>
              </View>
              {
                touched.bankName && isEmpty(cardBankName) &&
                <HelperText type="error">
                  {errors.bankName}
                </HelperText>
              }
              <TextInput
                label="Card owner name"
                //value={cardOwnerName}
                placeholder="Name printed on your card"
                onChangeText={text => setCardOwnerName(text)}
                mode="outlined"
                onBlur={() => handleBlur('ownerName')}
                style={[styles.formElements]}
              />
              {
                touched.ownerName && isEmpty(cardOwnerName) &&
                <HelperText type="error">
                  {errors.ownerName}
                </HelperText>
              }
              <TextInput
                label="Card Number"
                value={cardNumber}
                placeholder="0000 0000 0000 0000"
                onChangeText={text => setCardNumber(formatCardNumber(text))}
                maxLength={19}
                keyboardType="numeric"
                mode="outlined"
                onBlur={() => handleBlur('number')}
                style={styles.formElements}
              />
              {
                touched.number && (cardNumber.length === 0 || !/^(\d{4}\s?){3}\d{4}$/.test(cardNumber) || cardNumber.length !== 19) &&
                <HelperText type="error">
                  {errors.number}
                </HelperText>
              }

              <TextInput
                label="Expiry month"
                placeholder="00"
                //value={cardMonth}
                onChangeText={text => setCardMonth(text)}
                maxLength={2}
                keyboardType="numeric"
                mode="outlined"
                onBlur={() => handleBlur('month')}
                style={styles.formElements}
              />
              {
                touched.month && (isEmpty(cardMonth) || !/^(0[1-9]|1[0-2])$/.test(cardMonth) || cardMonth.length !== 2) &&
                <HelperText type="error">
                  {errors.month}
                </HelperText>
              }
              <TextInput
                label="Expiry year"
                placeholder="00"
                //value={cardYear}
                onChangeText={text => setCardYear(text)}
                maxLength={2}
                keyboardType="numeric"
                mode="outlined"
                onBlur={() => handleBlur('year')}
                style={styles.formElements}
              />
              {
                touched.year && (isEmpty(cardYear) || !/^(?:[1-9]|[1-9][0-9])$/.test(cardYear) || cardYear.length !== 2) &&
                <HelperText type="error">
                  {errors.year}
                </HelperText>
              }
              <TextInput
                label="CVV"
                placeholder="000"
                //value={cardCvv}
                onChangeText={text => setCardCvv(text)}
                maxLength={3}
                keyboardType="numeric"
                mode="outlined"
                onBlur={() => handleBlur('cvv')}
                style={styles.formElements}
              />
              {
                touched.cvv && (isEmpty(cardCvv) || !/^(?!0)([1-9][0-9]{0,2})$/.test(cardCvv) || cardCvv.length !== 3) &&
                <HelperText type="error">
                  {errors.cvv}
                </HelperText>
              }
              <TextInput
                style={styles.formElements}
                label="Card name"
                placeholder="Type/name of card"
                //value={cardName}
                onChangeText={text => setCardName(text)}
                mode="outlined"
                onBlur={() => handleBlur('name')}
              />
              {
                touched.name && isEmpty(cardName) &&
                <HelperText type="error">
                  {errors.name}
                </HelperText>
              }
              <TextInput
                label="Limit"
                placeholder="Your credit card limit"
                //value={cardLimit}
                onChangeText={text => setCardLimit(text)}
                maxLength={12}
                keyboardType="numeric"
                mode="outlined"
                onBlur={() => handleBlur('limit')}
                style={styles.formElements}
              />
              {
                touched.limit && (isEmpty(cardLimit) || !/^\d+$/.test(cardLimit)) &&
                <HelperText type="error">
                  {errors.limit}
                </HelperText>
              }
              <Button icon="send-circle" mode="contained" onTouchEnd={handleSubmit} disabled={!isFormValid} style={styles.button}              >
                Submit
              </Button>
            </ScrollView>
          </Modal>
        </Portal>


        <FlatList
          data={cardData}
          renderItem={({ item }) => (<CustomCard cardDetails={{...item,bankName:BANK_DICTIONARY[item.bankName]}} bankId={item.bankName}></CustomCard>)}
          keyExtractor={(item, index) => index.toString()}
          style={{ flex: 1, marginBottom: 10 }}
          contentContainerStyle={[{ flexGrow: 1 }, cardData.length ? null : { justifyContent: 'center' }]}
          ListEmptyComponent={<Text style={{ fontSize: 20, alignSelf: 'center' }}>{'No cards found!'}</Text>}
        />

        <FAB
          label="Add"
          style={styles.fab}
          color="white"
          onPress={showModal}
        />
      </View>
    </SafeAreaView>
  )
}

export default Home

const styles = StyleSheet.create({
  mainContainer: {
    backgroundColor: 'white',
    flex: 1
  },
  fab: {
    backgroundColor: '#1B1B1B',
    color: 'black',
    margin: 10,
  },
  containerStyle: {
    backgroundColor: 'white',
    padding: 20,
    marginHorizontal: 10,
    marginVertical: 60,
    borderRadius: 10
  },
  modelTitle: {
    fontSize: 22,
    alignSelf: 'center',
    margin: 10,
    color: 'black'
  },
  formElements: {
    marginVertical: 2,
    backgroundColor: 'white'
  },
  button: {
    marginVertical: 6,
  },
  menuButton: {

  },
  dropDownButton: {
    backgroundColor: 'black',
  }
})
