import { StyleSheet, View, Text, SafeAreaView } from 'react-native'
import React from 'react'
import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import Home from './Home';
import Login from './Login';

export type RootStackParamList = {
  Home: undefined;
  Login: undefined;
};

const Stack = createNativeStackNavigator();

const App = () => {

  return (

    <NavigationContainer>
      <Stack.Navigator initialRouteName="Login">
        <Stack.Screen name="Home" component={Home} />
        <Stack.Screen name="Login" component={Login} options={{title: 'Welcome to CWallet'}} />
      </Stack.Navigator>
    </NavigationContainer>
  )
}

export default App

