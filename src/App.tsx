import { StyleSheet, View, Text, SafeAreaView, Touchable, TouchableOpacity } from 'react-native'
import React from 'react'
import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import Home from './screens/Home';
import Login from './screens/Login';

export type RootStackParamList = {
  Home: undefined;
  Login: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const App = () => {

  return (

    <NavigationContainer>
      <Stack.Navigator initialRouteName="Login">
        <Stack.Screen name="Home" component={Home} options={{
          headerLeft: () => <></>,
        }} />
        <Stack.Screen name="Login" component={Login} options={{
          // title: 'CWallet',
          // headerTitleAlign:'center',
          // headerTransparent: true,
          // headerTintColor: '#000000',
          // headerTitleStyle:{
          //   fontSize:20
          // }
          headerShown: false
        }} />
      </Stack.Navigator>
    </NavigationContainer>
  )
}

export default App

