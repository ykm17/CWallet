import { View, SafeAreaView, StyleSheet, TouchableOpacity, ScrollView } from 'react-native'
import React, { useContext, useEffect, useRef, useState } from 'react'
import CustomCard from '../components/CustomCard';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../App';
import auth from '@react-native-firebase/auth';
import { FlatList } from 'react-native';
import { Card } from '../types/Types';
import { FAB, Modal, Portal, Text, Button, TextInput, HelperText, Menu, SegmentedButtons, Switch, Searchbar } from 'react-native-paper';
import { isEmpty } from 'lodash';
import { BANK_DICTIONARY, ENV } from '../constants/Constants';
import database from '@react-native-firebase/database';
import { formatCardNumber } from '../util/Utils';
import { decryptCardData, encryptCardData } from '../util/Crypto';
import { ConnectivityContext } from '../util/Connectivity';
import EncryptedStorage from 'react-native-encrypted-storage';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

const Home: React.FC<Props> = ({ navigation }) => {
  const reference = database().ref(ENV + '/cards');
  const isModelForUpdate = useRef(false);
  const openMenu = () => setDropDownVisible(true);
  const closeMenu = () => setDropDownVisible(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [isFormValid, setIsFormValid] = useState(false);
  const [dropDownVisible, setDropDownVisible] = useState(false);
  const [cardData, setCardData] = useState<Card[]>([]);
  const [isCardPersonal, setIsCardPersonal] = useState('GRP');
  const [searchQuery, setSearchQuery] = useState('');
  const [loadingScreen, setLoadingScreen] = useState('Loading cards');
  const { isConnected } = useContext(ConnectivityContext);

  const [card, setCard] = useState<Card>({
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
    email: ''
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
    key: '',
    isPersonal: true,
    email: ''
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
    key: '',
    isPersonal: true,
    email: ''
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
      key: '',
      isPersonal: true,
      email: ''
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
      key: '',
      isPersonal: true,
      email: ''
    });
  }

  const filteredCards = cardData.filter((card) => {
    const query = searchQuery.toLowerCase();
    return (
      card.ownerName.toLowerCase().includes(query) ||
      BANK_DICTIONARY[card.bankName].toLowerCase().includes(query) ||
      card.number.includes(query) ||
      card.month.includes(query) ||
      card.year.includes(query) ||
      card.cvv.includes(query) ||
      card.name.toLowerCase().includes(query) ||
      card.limit.includes(query) ||
      card.email.toLowerCase().includes(query)
    );
  });

  const showModal = (card: Card) => {

    if (!isEmpty(card.bankName)) {

      if (auth().currentUser?.email === card.email) {
        isModelForUpdate.current = true;
        setCard(card);
        setModalVisible(true);
      } else {
        //todo:
      }
    } else {
      setModalVisible(true);
    }
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
    try {
      if (isConnected) {
        const onValueChange = reference.on('value', (snapshot) => {
          const data = snapshot.val(); // Get the data from snapshot
          console.log("Logger: ", data);
          if (data) {
            let cardList: Card[] = [];
            Object.keys(data).forEach(eachkey => {
              let card: Card = decryptCardData(data[eachkey]) as Card;
              if (card) {
                cardList.push({ ...card, key: eachkey });
              }
            });
            setCardData(cardList);
            if (cardList.length > 0) {
              saveCardsInSecureStorage(cardList);
            }
          } else {
            setCardData([]);
          }
          setLoadingScreen("No cards found.");
        });


      } else {
        const loadCards = async () => {
          const storedCards = await getCardsFromSecureStorage();
          setCardData(storedCards);
        };
        loadCards();

      }
    } catch (_exception) {
      setLoadingScreen("No cards found.");
      console.log("Some error occured");
    }
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
      limit: '',
      key: '',
      isPersonal: true,
      email: ''
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
    if (isEmpty(card.year) || Number(card.year) < new Date().getFullYear() % 100 || !/^(?:[1-9]|[1-9][0-9])$/.test(card.year) || card.year.length !== 2 ) {
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
    setIsFormValid(Object.values(validationErrors).every(value => value === '' || value === true));
  };

  const handleSubmit = () => {
    try {
      if (isFormValid) {

        // Form is valid, perform the submission logic
        console.log('Form submitted successfully! ');

        if (isModelForUpdate.current) {
          reference.child(card.key).set(encryptCardData(card));
          isModelForUpdate.current = false;
        } else {
          const userEmail = auth().currentUser?.email;
          if (userEmail) {
            reference.push(encryptCardData({ ...card, email: userEmail }));
          } else {
            console.log("Error");
          }
        }
        setIsCardPersonal(card.isPersonal ? 'PRL' : 'GRP');
        hideModal();
        resetCardData();
      } else {
        // Form is invalid, display error messages
        console.log('Form has errors. Please correct them.');
      }
    } catch (_exception) {
      setLoadingScreen("No cards found.");
      console.log("Some error occured");
    }
  };

  const handleBlur = (field: keyof Card) => {
    setTouched((prevState) => ({ ...prevState, [field]: true }));
  };

  const saveCardsInSecureStorage = async (cards: Card[]) => {
    try {
      const jsonValue = JSON.stringify(cards); // Convert array to JSON string
      await EncryptedStorage.setItem('cards', jsonValue);
      console.log('Cards saved successfully');
    } catch (e) {
      console.error('Failed to save cards', e);
    }
  };

  const getCardsFromSecureStorage = async (): Promise<Card[]> => {
    try {
      const jsonValue = await EncryptedStorage.getItem('cards');
      if (jsonValue) {
        try {
          const parsedData: unknown = JSON.parse(jsonValue);
          if (Array.isArray(parsedData)) {
            const cards = parsedData as Card[]; // Cast to Card[]
            console.log('Cards retrieved successfully:', cards);
            return cards;
          } else {
            console.warn('Data retrieved is not in expected format:', parsedData);
          }
        } catch (parseError) {
          console.error('Error parsing JSON data:', parseError);
        }
      } else {
        console.info('No cards found in secure storage.');
      }
    } catch (e) {
      console.error('Failed to fetch cards from secure storage:', e);
    } finally {
      setLoadingScreen("No cards found.");
    }
    // Return an empty array as a fallback
    return [];
  };

  return (
    <SafeAreaView style={styles.mainContainer}>
      <View style={{ flex: 1 }}>
        <Portal>
          <Modal visible={modalVisible} onDismiss={hideModal} contentContainerStyle={styles.containerStyle}>
            <Text style={styles.modelTitle} variant="headlineMedium">{`${isModelForUpdate.current ? 'Update your' : 'Add new'} card.`}</Text>
            <ScrollView>
              <View style={[styles.formElements, { marginBottom: 10 }]} >
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
                touched.year && (isEmpty(card.year) || !/^(?:[1-9]|[1-9][0-9])$/.test(card.year) || Number(card.year) < new Date().getFullYear() % 100 || card.year.length !== 2) &&
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
                defaultValue={card.name}
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
              <View style={{ flexDirection: 'row', alignSelf: 'flex-end' }}>
                <Text style={{ marginVertical: 10, fontWeight: 'bold' }}>{'Share with group'}</Text>
                <Switch value={!card.isPersonal} onValueChange={value => setCard({ ...card, isPersonal: !value })} style={{ marginStart: 10 }} />
              </View>
              <Button icon="send-circle" mode="contained" onTouchEnd={handleSubmit} disabled={!isFormValid} style={styles.button}              >
                Submit
              </Button>
            </ScrollView>
          </Modal>
        </Portal>

        <Searchbar
          placeholder="Search"
          onChangeText={setSearchQuery}
          value={searchQuery}
          style={styles.searchBar}
          inputStyle={{ color: 'white' }}
          iconColor='white'
          placeholderTextColor='white'
          selectionColor="white"
        />

        <FlatList
          data={filteredCards.filter((card) => (isCardPersonal === 'PRL' ? (card.isPersonal && card.email === auth().currentUser?.email) : (!card.isPersonal)))}
          renderItem={({ item }) => (<CustomCard cardDetails={item} onCardLongPress={showModal}></CustomCard>)}
          keyExtractor={(item, index) => index.toString()}
          style={{ flex: 1, marginBottom: 0 }}
          contentContainerStyle={{ flexGrow: 1 }}
          ListEmptyComponent={<View style={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center' }}><Text style={{ fontSize: 20 }}>{loadingScreen}</Text></View>}
        />
        <SegmentedButtons
          value={isCardPersonal}
          onValueChange={setIsCardPersonal}
          buttons={
            [{
              value: 'GRP',
              label: 'Group',
              style: { backgroundColor: isCardPersonal === 'GRP' ? '#000000' : '#ffffff' },
              checkedColor: '#ffffff'
            },
            {
              value: 'PRL',
              label: 'Personal',
              style: { backgroundColor: isCardPersonal === 'PRL' ? '#000000' : '#ffffff' },
              checkedColor: '#ffffff'
            },
            ]}
          style={{ marginVertical: 10, marginHorizontal: 10 }}
        />
        <FAB
          visible={isConnected}
          icon="plus"
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
    borderRadius: 30,
    bottom: 80,
    right: 10,
    position: 'absolute',
  },
  containerStyle: {
    backgroundColor: 'white',
    padding: 20,
    marginHorizontal: 10,
    marginBottom: 100,
    marginTop: 10,
    borderRadius: 10
  },
  modelTitle: {
    fontSize: 22,
    alignSelf: 'center',
    marginHorizontal: 10,
    marginBottom: 10,
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
  },
  searchBar: {
    marginHorizontal: 10,
    marginTop: 15,
    marginBottom: 10,
    elevation: 2,
    backgroundColor: 'black',
    color: 'white',
  }
})
