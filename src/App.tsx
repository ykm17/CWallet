import { StyleSheet, View, Text, SafeAreaView, Touchable, TouchableOpacity, Platform } from 'react-native'
import React, { useEffect } from 'react'
import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import Home from './screens/Home';
import Login from './screens/Login';
import { enableSecureView, disableSecureView, forbidAndroidShare, allowAndroidShare } from 'react-native-prevent-screenshot-ios-android';

export type RootStackParamList = {
  Home: undefined;
  Login: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const App = () => {
  useEffect(() => {
    if (Platform.OS === 'android') {
      forbidAndroidShare(); // Blocks screenshot, screen recording, and sharing on Android
    } else if (Platform.OS === 'ios') {
      enableSecureView(); // Blocks screenshot and screen recording on iOS
    }

    // Optional: Clean up by allowing screenshots on component unmount
    return () => {
      if (Platform.OS === 'android') {
        allowAndroidShare(); // Re-enables screenshot and sharing on Android
      } else if (Platform.OS === 'ios') {
        disableSecureView(); // Re-enables screenshot on iOS
      }
    };
  }, []);
  return (

    <NavigationContainer>
      <Stack.Navigator initialRouteName="Login">
        <Stack.Screen name="Home" component={Home} options={{
          headerLeft: () => <></>,
          headerTitleAlign: 'center',
          statusBarColor: 'white',
          statusBarStyle: 'dark'
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

