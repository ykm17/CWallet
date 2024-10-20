import { View, SafeAreaView, StyleSheet, TouchableOpacity, ScrollView } from 'react-native'
import React, { useEffect, useRef, useState } from 'react'
import CustomCard from '../components/CustomCard';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../App';
import auth from '@react-native-firebase/auth';
import { FlatList } from 'react-native';
import { Card } from '../types/Types';
import { FAB, Modal, Portal, Text, Button, TextInput, HelperText, Menu } from 'react-native-paper';
import { isEmpty } from 'lodash';
import { BANK_DICTIONARY, ENV } from '../constants/Constants';
import database from '@react-native-firebase/database';
import { formatCardNumber } from '../util/Utils';
import { decryptCardData, encryptCardData } from '../util/Crypto';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

const Home: React.FC<Props> = ({ navigation }) => {
  const reference = database().ref(ENV + '/cards');
  const isModelForUpdate = useRef(false);
  const openMenu = () => setDropDownVisible(true);
  const closeMenu = () => setDropDownVisible(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [isFormValid, setIsFormValid] = useState(false);
  const [dropDownVisible, setDropDownVisible] = React.useState(false);
  const [cardData, setCardData] = useState<Card[]>([]);
  const [card, setCard] = useState<Card>({
    ownerName: '',
    bankName: '',
    number: '',
    month: '',
    year: '',
    cvv: '',
    name: '',
    limit: '',
    key: ''
  });
  const [errors, setErrors] = useState<Card>({
    ownerName: '',
    bankName: '',
    number: '',
    month: '',
    year: '',
    cvv: '',
    name: '',
    limit: '',
    key: ''
  });
  const [touched, setTouched] = useState<Card>({
    ownerName: '',
    bankName: '',
    number: '',
    month: '',
    year: '',
    cvv: '',
    name: '',
    limit: '',
    key: ''
  });

  const resetCardData = () => {
    setCard({
      ownerName: '',
      bankName: '',
      number: '',
      month: '',
      year: '',
      cvv: '',
      name: '',
      limit: '',
      key: ''
    });
    setTouched({
      ownerName: '',
      bankName: '',
      number: '',
      month: '',
      year: '',
      cvv: '',
      name: '',
      limit: '',
      key: ''
    });
  }
  
  const showModal = (card: Card) => {

    if (!isEmpty(card.bankName)) {
      isModelForUpdate.current = true;
      setCard(card);
      //setCard(card);

      console.log("\n\n");
      console.log("LOGGER 1: ", card);
      console.log("LOGGER 1: ", isModelForUpdate);
      console.log("\n\n");
    } else {
      console.log("LOGGER 2");
    }
    setModalVisible(true);
  }
  const hideModal = () => {
    setModalVisible(false);
    resetCardData();
  }

  useEffect(() => {
    validateForm();
  }, [card]);

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => <TouchableOpacity onPress={signOutUser}><Text style={{ color: 'black' }}>Logout</Text></TouchableOpacity>,
    });
  }, []);

  useEffect(() => {
    const onValueChange = reference.on('value', (snapshot) => {
      const data = snapshot.val(); // Get the data from snapshot

      if (data) {
        let cardList: Card[] = [];
        Object.keys(data).forEach(eachkey => {
          let card: Card = decryptCardData(data[eachkey]) as Card;
          cardList.push({...card,key:eachkey});
        });
        setCardData(cardList); 
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
    console.log("LOGGER 3: ", card);

    let validationErrors: Card = {
      ownerName: '',
      bankName: '',
      number: '',
      month: '',
      year: '',
      cvv: '',
      name: '',
      limit: '',
      key: ''
    };

    if (isEmpty(card.ownerName)) {
      validationErrors.ownerName = "Owner name is required";
    }
    if (isEmpty(card.bankName)) {
      validationErrors.bankName = "Please select bank name";
    }
    if (isEmpty(card.number) || !/^(\d{4}\s?){3}\d{4}$/.test(card.number) || card.number.length !== 19) {
      validationErrors.number = "Card number is empty or invalid";
    }
    if (isEmpty(card.month) || !/^(0[1-9]|1[0-2])$/.test(card.month) || card.month.length !== 2) {
      validationErrors.month = "Card month is empty or invalid";
    }
    if (isEmpty(card.year) || !/^(?:[1-9]|[1-9][0-9])$/.test(card.year) || card.year.length !== 2) {
      validationErrors.year = "Card year is empty or invalid";
    }
    if (isEmpty(card.cvv) || !/^(?!0)([1-9][0-9]{0,2})$/.test(card.cvv) || card.cvv.length !== 3) {
      validationErrors.cvv = "CVV is empty or invalid";
    }
    if (isEmpty(card.name)) {
      validationErrors.name = "Card name cannot be empty";
    }
    if (isEmpty(card.limit) || !/^\d+$/.test(card.limit)) {
      validationErrors.limit = "Card limit is empty or invalid";
    }

    setErrors(validationErrors);
    setIsFormValid(Object.values(validationErrors).every(value => value == ''));
  };

  const handleSubmit = () => {
    if (isFormValid) {

      // Form is valid, perform the submission logic
      console.log('Form submitted successfully! ');

      if (isModelForUpdate.current) {
        reference.child(card.key).set(encryptCardData(card));
        isModelForUpdate.current = false;
      } else {
        reference.push(encryptCardData(card));
      }

      hideModal();
      resetCardData();
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
            <Text style={styles.modelTitle} variant="headlineMedium">{`${isModelForUpdate.current?'Update your':'Add new'} card.`}</Text>
            <ScrollView>
              <View style={[styles.formElements,{marginBottom:10}]} >
                <Menu
                  contentStyle={{ backgroundColor: 'white' }}
                  visible={dropDownVisible}
                  onDismiss={closeMenu}
                  anchor={<Button onPress={openMenu} style={styles.dropDownButton} labelStyle={{ color: 'white', width: '100%' }}>{BANK_DICTIONARY[card.bankName] ?? "Select Bank"}</Button>}>
                  {
                    Object.keys(BANK_DICTIONARY).map((item, index) => (
                      <Menu.Item onPress={() => (setCard({ ...card, bankName: item }), closeMenu())} title={BANK_DICTIONARY[item]} key={index} />
                    ))
                  }
                </Menu>
              </View>
              {
                touched.bankName && isEmpty(card.bankName) &&
                <HelperText type="error">
                  {errors.bankName}
                </HelperText>
              }
              <TextInput
                label="Card owner name"
                defaultValue={card.ownerName}
                placeholder="Name printed on your card"
                onChangeText={text => setCard({ ...card, ownerName: text })}
                mode="outlined"
                onBlur={() => handleBlur('ownerName')}
                style={[styles.formElements]}
              />
              {
                touched.ownerName && isEmpty(card.ownerName) &&
                <HelperText type="error">
                  {errors.ownerName}
                </HelperText>
              }
              <TextInput
                label="Card Number"
                value={card.number}
                placeholder="0000 0000 0000 0000"
                onChangeText={text => setCard({ ...card, number: formatCardNumber(text) })}
                maxLength={19}
                keyboardType="numeric"
                mode="outlined"
                onBlur={() => handleBlur('number')}
                style={styles.formElements}
              />
              {
                touched.number && (card.number.length === 0 || !/^(\d{4}\s?){3}\d{4}$/.test(card.number) || card.number.length !== 19) &&
                <HelperText type="error">
                  {errors.number}
                </HelperText>
              }

              <TextInput
                label="Expiry month"
                placeholder="00"
                defaultValue={card.month}
                onChangeText={text => setCard({ ...card, month: text })}
                maxLength={2}
                keyboardType="numeric"
                mode="outlined"
                onBlur={() => handleBlur('month')}
                style={styles.formElements}
              />
              {
                touched.month && (isEmpty(card.month) || !/^(0[1-9]|1[0-2])$/.test(card.month) || card.month.length !== 2) &&
                <HelperText type="error">
                  {errors.month}
                </HelperText>
              }
              <TextInput
                label="Expiry year"
                placeholder="00"
                defaultValue={card.year}
                onChangeText={text => setCard({ ...card, year: text })}
                maxLength={2}
                keyboardType="numeric"
                mode="outlined"
                onBlur={() => handleBlur('year')}
                style={styles.formElements}
              />
              {
                touched.year && (isEmpty(card.year) || !/^(?:[1-9]|[1-9][0-9])$/.test(card.year) || card.year.length !== 2) &&
                <HelperText type="error">
                  {errors.year}
                </HelperText>
              }
              <TextInput
                label="CVV"
                placeholder="000"
                defaultValue={card.cvv}
                onChangeText={text => setCard({ ...card, cvv: text })}
                maxLength={3}
                keyboardType="numeric"
                mode="outlined"
                onBlur={() => handleBlur('cvv')}
                style={styles.formElements}
              />
              {
                touched.cvv && (isEmpty(card.cvv) || !/^(?!0)([1-9][0-9]{0,2})$/.test(card.cvv) || card.cvv.length !== 3) &&
                <HelperText type="error">
                  {errors.cvv}
                </HelperText>
              }
              <TextInput
                style={styles.formElements}
                label="Card name"
                placeholder="Type/name of card"
                defaultValue={card.cvv}
                onChangeText={text => setCard({ ...card, name: text })}
                mode="outlined"
                onBlur={() => handleBlur('name')}
              />
              {
                touched.name && isEmpty(card.name) &&
                <HelperText type="error">
                  {errors.name}
                </HelperText>
              }
              <TextInput
                label="Limit"
                placeholder="Your credit card limit"
                defaultValue={card.limit}
                onChangeText={text => setCard({ ...card, limit: text })}
                maxLength={12}
                keyboardType="numeric"
                mode="outlined"
                onBlur={() => handleBlur('limit')}
                style={styles.formElements}
              />
              {
                touched.limit && (isEmpty(card.limit) || !/^\d+$/.test(card.limit)) &&
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
          renderItem={({ item }) => (<CustomCard cardDetails={item} onCardLongPress={showModal}></CustomCard>)}
          keyExtractor={(item, index) => index.toString()}
          style={{ flex: 1, marginBottom: 10 }}
          contentContainerStyle={[{ flexGrow: 1 }, cardData.length ? null : { justifyContent: 'center' }]}
          ListEmptyComponent={<Text style={{ fontSize: 20, alignSelf: 'center' }}>{'No cards found!'}</Text>}
        />

        <FAB
          label="Add"
          style={styles.fab}
          color="white"
          onPress={() => {
            showModal(card)
          }}
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
