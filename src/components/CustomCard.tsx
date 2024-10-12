import { StyleSheet, Text, TouchableWithoutFeedback, View } from 'react-native'
import React from 'react'
import { Card } from '../types/Types'
import Clipboard from '@react-native-clipboard/clipboard'
import { formatCardNumber, removeSpaceFromString } from '../util/Utils'

interface CardProps {
  cardDetails: Card
}

const CustomCard: React.FC<CardProps> = ({ cardDetails }) => {

  
  const copyToClipboard = () => {
    Clipboard.setString(removeSpaceFromString(cardDetails.number)); // Copy the text to clipboard
  };
  return (
    <View style={styles.container}>

      <Text style={styles.heading}>{cardDetails.name}</Text>
      <Text style={styles.heading}>{cardDetails.limit}</Text>

      <View style={styles.cardNumberSection}>
        <Text style={styles.title}>CARD NUMBER</Text>
        <TouchableWithoutFeedback onLongPress={copyToClipboard}>
          <Text style={styles.subTitle}>{formatCardNumber(cardDetails.number)}</Text>
        </TouchableWithoutFeedback>
      </View>

      <View style={styles.expirySection}>
        <View>
          <Text style={styles.title}>EXPIRY & CVV</Text>
          <Text style={styles.subTitle}>{cardDetails.month}/{cardDetails.year}     {cardDetails.cvv}</Text>
        </View>
        <View>
          <Text style={[styles.title, { alignSelf: 'flex-end' }]}>BANK NAME</Text>
          <Text style={styles.subTitle}>{cardDetails.bankName}</Text>
        </View>
      </View>



    </View>
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
  heading: {
    alignSelf: 'flex-end',
    color: 'white'
  },
  bankName: {
    color: '#ffffff',
  },
  cardDetails: {
    color: '#ffffff',
  },
  title: {
    color: '#ffffff',
    fontSize: 10
  },
  subTitle: {
    color: '#ffffff',
    fontSize: 20
  },
  expirySection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10
  },
  cardNumberSection: {
    marginBottom: 12,
    marginTop: 30
  }


})
