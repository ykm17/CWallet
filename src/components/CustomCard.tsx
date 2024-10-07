import { StyleSheet, Text, View } from 'react-native'
import React from 'react'
import { Card } from '../types/Types'

interface CardProps {
  cardDetails: Card
}

const CustomCard: React.FC<CardProps> = ({ cardDetails }) => {
  return (
    <View style={styles.container}>
      <Text style={styles.bankName}>{cardDetails.bankName}</Text>
      <Text style={styles.cardDetails}>{cardDetails.number}</Text>
      <Text style={styles.cardDetails}>Exp: {cardDetails.month}/{cardDetails.year}</Text>
      <Text style={styles.cardDetails}>CVV: {cardDetails.cvv}</Text>
      <Text style={styles.cardDetails}>Limit: {cardDetails.limit}</Text>
      <Text style={styles.cardDetails}>Owner: {cardDetails.ownerName}</Text>
    </View>
  )
}
export default CustomCard

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#424242',
    padding: 10,
    margin: 10,
    borderRadius: 10
  },
  bankName: {
    color: '#ffffff',
  },
  cardDetails: {
    color: '#ffffff',
  },

})