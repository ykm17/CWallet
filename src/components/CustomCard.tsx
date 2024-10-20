import { StyleSheet, Text, TouchableWithoutFeedback, View } from 'react-native'
import React from 'react'
import { Card } from '../types/Types'
import Clipboard from '@react-native-clipboard/clipboard'
import { formatCardNumber, removeSpaceFromString } from '../util/Utils'
import { BANK_COLORS, BANK_DICTIONARY } from '../constants/Constants'
import { Icon } from 'react-native-paper'

interface CardProps {
  cardDetails: Card,
  onCardLongPress: (card: Card) => void
}

const CustomCard: React.FC<CardProps> = ({ cardDetails, onCardLongPress }) => {

  const copyNumberToClipboard = () => {
    Clipboard.setString(removeSpaceFromString(cardDetails.number)); // Copy the text to clipboard
  };

  const copyCardDetialsToClipboard = () => {
    Clipboard.setString(`Bank Name: ${BANK_DICTIONARY[cardDetails.bankName]}\nName: ${cardDetails.ownerName}\nCard No: ${cardDetails.number}\nExp: ${cardDetails.month}/${cardDetails.year}\nCvv: ${cardDetails.cvv}`); // Copy the text to clipboard
  };

  console.log("YASH: ", cardDetails);
  return (
    <TouchableWithoutFeedback onLongPress={() => { onCardLongPress(cardDetails) }}>

      <View style={[styles.container, { backgroundColor: BANK_COLORS[cardDetails.bankName] }]}>
        <View style={styles.spaceContainer}>
          <View>
            <Text style={styles.heading_1}>{'Card Owner'}</Text>
            <Text style={styles.subheading_1}>{cardDetails.ownerName} {'(' + cardDetails.limit + ')'}</Text>
          </View>
          {/* <View>
          <Text style={[styles.heading_1, { alignSelf: 'flex-end' }]}>{cardDetails.name}</Text>
          <Text style={styles.subheading_1}>{cardDetails.limit}</Text>
        </View> */}
          <TouchableWithoutFeedback onLongPress={copyCardDetialsToClipboard}>
            <View style={{ alignSelf: 'center' }}>
              <Icon
                source="credit-card-chip"
                color="white"
                size={40}
              />
            </View>
          </TouchableWithoutFeedback>

        </View>
        <View style={[styles.spaceContainer]}>
          <View style={styles.cardNumberSection}>
            <Text style={styles.heading_1}>CARD NUMBER</Text>
            <TouchableWithoutFeedback onLongPress={copyNumberToClipboard}>
              <Text style={styles.subheading_2}>{cardDetails.number}</Text>
            </TouchableWithoutFeedback>
          </View>
        </View>
        <View style={styles.spaceContainer}>
          <View>
            <Text style={styles.heading_1}>EXPIRY & CVV</Text>
            <Text style={styles.subheading_2}>{cardDetails.month}/{cardDetails.year}     {cardDetails.cvv}</Text>
          </View>
          <View>
            <Text style={[styles.heading_1, { alignSelf: 'flex-end' }]}>BANK NAME</Text>
            <Text style={styles.subheading_2}>{BANK_DICTIONARY[cardDetails.bankName]}</Text>
          </View>
        </View>
      </View>
    </TouchableWithoutFeedback>
  )
}
export default CustomCard

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1B1B1B',
    padding: 18,
    marginTop: 12,
    marginStart: 10,
    marginEnd: 10,
    borderRadius: 10
  },
  heading_1: {
    alignSelf: 'flex-start',
    color: 'white',
    fontSize: 10
  },
  heading_2: {
    alignSelf: 'flex-end',
    color: 'white',
    fontSize: 10
  },
  subheading_1: {
    color: 'white'
  },
  subheading_2: {
    color: '#ffffff',
    fontSize: 20
  },
  spaceContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10
  },
  cardNumberSection: {
    marginBottom: 0,
    marginTop: 10
  }


})
