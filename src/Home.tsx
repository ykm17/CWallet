import { View, Text, SafeAreaView,StyleSheet } from 'react-native'
import React from 'react'
import CustomCard from './components/CustomCard'

const Home = () => {
  return (
    <SafeAreaView style={styles.mainContainer}>
      <View >
        <CustomCard></CustomCard>
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