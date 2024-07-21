import { StyleSheet, Text, View } from 'react-native'
import React from 'react'

export default function CustomCard() {
  return (
    <View style={styles.container}>
      <Text style={styles.bankName}>SBI</Text>
      <Text style={styles.cardDetails}>1234 3456 3455 4534</Text>
      <Text style={styles.cardDetails}>Exp: 02/12</Text>
      <Text style={styles.cardDetails}>CVV: 123</Text>
      <Text style={styles.cardDetails}>Limit: 1000000</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container:{
    backgroundColor: '#424242',
    padding: 10,
    margin: 10,
    borderRadius: 10
  },
  bankName:{
    color:'#ffffff',
  },
  cardDetails:{
    color:'#ffffff',  
  },

})