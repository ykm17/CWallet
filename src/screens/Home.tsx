import { View, SafeAreaView, StyleSheet, TouchableOpacity } from 'react-native'
import React, { useEffect, useState } from 'react'
import CustomCard from '../components/CustomCard';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../App';
import auth from '@react-native-firebase/auth';
import { FlatList } from 'react-native';
import { Card } from '../types/Types';
import { FAB, Modal, Portal, Text, Button, PaperProvider, TextInput, HelperText, Menu, Divider } from 'react-native-paper';
import { isEmpty } from 'lodash'; // Import lodash isEmpty
import { BANK_DICTIONARY } from '../constants/Constants';

const cards = [
  {
    ownerName: "Alice Johnson",
    bankName: "Bank of America",
    number: "4539 1488 0343 6467",
    month: "06",
    year: "2025",
    cvv: "123",
    name: "Platinum",
    limit: "10000"
  },
  {
    ownerName: "Bob Smith",
    bankName: "Chase Bank",
    number: "4485 2947 4934 1023",
    month: "12",
    year: "2024",
    cvv: "456",
    name: "Gold",
    limit: "15000"
  },
  {
    ownerName: "Charlie Davis",
    bankName: "Wells Fargo",
    number: "4929 8761 2034 9456",
    month: "08",
    year: "2026",
    cvv: "789",
    name: "Silver",
    limit: "7500"
  },
  {
    ownerName: "Dana Lee",
    bankName: "Citi Bank",
    number: "4532 6734 5482 9871",
    month: "04",
    year: "2023",
    cvv: "321",
    name: "Platinum",
    limit: "12000"
  },
  {
    ownerName: "Ethan Wright",
    bankName: "HSBC",
    number: "4532 8765 1234 8902",
    month: "01",
    year: "2027",
    cvv: "654",
    name: "Titanium",
    limit: "18000"
  },
  {
    ownerName: "Fiona Hill",
    bankName: "Barclays",
    number: "4539 2334 5678 1234",
    month: "10",
    year: "2024",
    cvv: "987",
    name: "Gold",
    limit: "20000"
  },
  {
    ownerName: "George Martin",
    bankName: "Deutsche Bank",
    number: "4485 8763 2958 4321",
    month: "03",
    year: "2026",
    cvv: "123",
    name: "Silver",
    limit: "8000"
  },
  {
    ownerName: "Helen Clark",
    bankName: "Santander",
    number: "4532 9284 2310 7845",
    month: "11",
    year: "2025",
    cvv: "456",
    name: "Bronze",
    limit: "5000"
  },
  {
    ownerName: "Ian Lopez",
    bankName: "BNP Paribas",
    number: "4532 4521 7890 1234",
    month: "05",
    year: "2023",
    cvv: "789",
    name: "Gold",
    limit: "16000"
  },
  {
    ownerName: "Julia Roberts",
    bankName: "Standard Chartered",
    number: "4539 2341 6789 0987",
    month: "07",
    year: "2026",
    cvv: "321",
    name: "Platinum",
    limit: "25000"
  }
];
type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

const Home: React.FC<Props> = ({ navigation }) => {

  const [visible, setVisible] = useState(false);
  //Modal input fields
  const [cardOwnerName, setCardOwnerName] = useState("");
  const [cardBankName, setCardBankName] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [cardMonth, setCardMonth] = useState("");
  const [cardYear, setCardYear] = useState("");
  const [cardCvv, setCardCvv] = useState("");
  const [cardName, setCardName] = useState("");
  const [cardLimit, setCardLimit] = useState("");
  const [errors, setErrors] = useState<Card>({});
  const [isFormValid, setIsFormValid] = useState(false);

  const [dropDownVisible, setDropDownVisible] = React.useState(false);
  const openMenu = () => setDropDownVisible(true);
  const closeMenu = () => setDropDownVisible(false);

  const showModal = () => setVisible(true);
  const hideModal = () => setVisible(false);
  useEffect(() => {
    validateForm();
  }, [cardOwnerName, cardBankName, cardNumber, cardMonth, cardYear, cardCvv, cardName, cardLimit]);

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => <TouchableOpacity onPress={signOutUser}><Text>Logout</Text></TouchableOpacity>,
    });
  }, []);

  const signOutUser = async () => {
    try {
      // Sign out from Firebase
      await auth().signOut();
      // Sign out from Google
      await GoogleSignin.signOut();
      navigation.navigate('Login');
      console.log('User signed out from Firebase and Google');
    } catch (error) {
      console.error('Sign-out Error:', error);
    }
  };

  const validateForm = () => {
    let validationErrors: Card = {};

    if (isEmpty(cardOwnerName)) {
      validationErrors.ownerName = "Owner name is required";
    }
    if (isEmpty(cardBankName)) {
      validationErrors.bankName = "Please select bank name";
    }
    if (isEmpty(cardNumber) || !/^\d+$/.test(cardNumber)) {
      validationErrors.number = "Card number is empty or invalid";
    }
    if (isEmpty(cardMonth) || !/^\d+$/.test(cardMonth)) {
      validationErrors.month = "Card month is empty or invalid";
    }
    if (isEmpty(cardYear) || !/^\d+$/.test(cardYear)) {
      validationErrors.year = "Card year is empty or invalid";
    }
    if (isEmpty(cardCvv) || !/^\d+$/.test(cardCvv)) {
      validationErrors.cvv = "CVV is empty or invalid";
    }
    if (isEmpty(cardName)) {
      validationErrors.name = "Card name cannot be empty";
    }
    if (isEmpty(cardLimit) || !/^\d+$/.test(cardLimit)) {
      validationErrors.limit = "Card limit is empty or invalid";
    }

    setErrors(validationErrors);
    setIsFormValid(Object.keys(validationErrors).length === 0);
  };

  const handleSubmit = () => {
    if (isFormValid) {

      // Form is valid, perform the submission logic
      console.log('Form submitted successfully!');
    } else {

      // Form is invalid, display error messages
      console.log('Form has errors. Please correct them.');
    }
  };

  return (
    <SafeAreaView style={styles.mainContainer}>
      <View style={{ flex: 1 }}>
        <Portal>
          <Modal visible={visible} onDismiss={hideModal} contentContainerStyle={styles.containerStyle}>
            <Text>Fill details to add new card !</Text>
            <TextInput
              label="Card owner name"
              value={cardOwnerName}
              placeholder="Name printed on your card"
              onChangeText={text => setCardOwnerName(text)}
            />
            {
              isEmpty(cardOwnerName) &&
              <HelperText type="error">
                {errors.ownerName}
              </HelperText>
            }
            <TextInput
              label="Card Number"
              value={cardNumber}
              placeholder="0000 0000 0000 0000"
              onChangeText={text => setCardNumber(text)}
              maxLength={12}
              keyboardType="numeric"
            />
            {
              (isEmpty(cardNumber) || !/^\d+$/.test(cardNumber)) &&
              <HelperText type="error">
                {errors.number}
              </HelperText>
            }

            <TextInput
              label="Expiry month"
              placeholder="00"
              value={cardMonth}
              onChangeText={text => setCardMonth(text)}
              maxLength={2}
            />
            {
              (isEmpty(cardMonth) || !/^\d+$/.test(cardMonth)) &&
              <HelperText type="error">
                {errors.month}
              </HelperText>
            }
            <TextInput
              label="Expiry year"
              placeholder="00"
              value={cardYear}
              onChangeText={text => setCardYear(text)}
              maxLength={2}
            />
            {
              (isEmpty(cardYear) || !/^\d+$/.test(cardYear)) &&
              <HelperText type="error">
                {errors.year}
              </HelperText>
            }
            <TextInput
              label="CVV"
              placeholder="000"
              value={cardCvv}
              onChangeText={text => setCardCvv(text)}
              maxLength={3}
            />
            {
              (isEmpty(cardCvv) || !/^\d+$/.test(cardCvv)) &&
              <HelperText type="error">
                {errors.cvv}
              </HelperText>
            }

            <Menu
              visible={dropDownVisible}
              onDismiss={closeMenu}
              anchor={<Button onPress={openMenu}>{BANK_DICTIONARY[cardBankName] ?? "Select Bank"}</Button>}>
              {/* loop menu items */}

              {Object.keys(BANK_DICTIONARY).map((item,index) => (
                <Menu.Item onPress={()=>(setCardBankName(item),closeMenu())} title={BANK_DICTIONARY[item]} key={index}/>
                
              ))}
            </Menu>
            {
              isEmpty(cardBankName) &&
              <HelperText type="error">
                {errors.bankName}
              </HelperText>
            }
            <TextInput
              label="Card name"
              value={cardName}
              onChangeText={text => setCardName(text)}
            />
            {
              isEmpty(cardName) &&
              <HelperText type="error">
                {errors.name}
              </HelperText>
            }
            <TextInput
              label="Limit"
              placeholder="Your credit card limit"
              value={cardLimit}
              onChangeText={text => setCardLimit(text)}
              maxLength={12}
            />
            {
              (isEmpty(cardLimit) || !/^\d+$/.test(cardLimit)) &&
              <HelperText type="error">
                {errors.limit}
              </HelperText>
            }
            <Button icon="send-circle" mode="contained" onPress={handleSubmit} disabled={!isFormValid}>
              Submit
            </Button>

          </Modal>
        </Portal>
        <FlatList
          data={cards}
          renderItem={({ item }) => (<CustomCard cardDetails={item}></CustomCard>)}
          keyExtractor={item => item.number}
          style={{ flex: 1, marginBottom: 10 }}
        />
        <FAB
          icon="plus"
          label="Add"

          variant="secondary"
          style={styles.fab}
          onPress={showModal}
        />
      </View>
    </SafeAreaView>
  )
}

export default Home

const styles = StyleSheet.create({
  mainContainer: {
    backgroundColor: '#000000',
    flex: 1
  },
  fab: {
    backgroundColor: 'white'
  },
  containerStyle: {
    backgroundColor: 'white',
    padding: 20,
  }
})
