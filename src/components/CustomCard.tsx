import { StyleSheet, Text, TouchableWithoutFeedback, View } from 'react-native'
import React from 'react'
import { Card } from '../types/Types'
import Clipboard from '@react-native-clipboard/clipboard'
import { formatCardNumber, removeSpaceFromString } from '../util/Utils'
import { BANK_COLORS } from '../constants/Constants'
import { Icon, MD3Colors } from 'react-native-paper'

interface CardProps {
  cardDetails: Card,
  bankId: string,
}

const CustomCard: React.FC<CardProps> = ({ cardDetails, bankId }) => {


  const copyToClipboard = () => {
    Clipboard.setString(removeSpaceFromString(cardDetails.number)); // Copy the text to clipboard
  };
  console.log("YASH: ", cardDetails);
  return (
    <View style={[styles.container, { backgroundColor: BANK_COLORS[bankId] }]}>
      <View style={styles.spaceContainer}>
        <View>
          <Text style={styles.heading_1}>{'Card Owner'}</Text>
          <Text style={styles.subheading_1}>{cardDetails.ownerName}</Text>
        </View>
        {/* <View>
          <Text style={[styles.heading_1, { alignSelf: 'flex-end' }]}>{cardDetails.name}</Text>
          <Text style={styles.subheading_1}>{cardDetails.limit}</Text>
        </View> */}
         <View style={{alignSelf:'center'}}>
          <Icon
            source="credit-card-chip"
            color="white"
            size={40}
          />
        </View>
      </View>
      <View style={[styles.spaceContainer]}>
        <View style={styles.cardNumberSection}>
          <Text style={styles.heading_1}>CARD NUMBER</Text>
          <TouchableWithoutFeedback onLongPress={copyToClipboard}>
            <Text style={styles.subheading_2}>{formatCardNumber(cardDetails.number)}</Text>
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
          <Text style={styles.subheading_2}>{cardDetails.bankName}</Text>
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
