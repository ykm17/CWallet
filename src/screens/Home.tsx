import { View, Text, SafeAreaView, StyleSheet, ScrollView } from 'react-native'
import React from 'react'
import CustomCard from '../components/CustomCard';

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


const Home = () => {
  return (
    <SafeAreaView style={styles.mainContainer}>
      <View>
        <ScrollView>
          {cards.map((eachCard, index) => (
            <CustomCard cardDetails={eachCard} key={index}></CustomCard>
          ))}
        </ScrollView>
      </View>
    </SafeAreaView>
  )
}

export default Home

const styles = StyleSheet.create({
  mainContainer: {
    backgroundColor: '#000000',
    flex: 1
  }
})