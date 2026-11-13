import { StyleSheet, View, Text, SafeAreaView, Touchable, TouchableOpacity, Platform } from 'react-native'
import React, { useContext, useEffect } from 'react'
import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import Home from './screens/Home';
import Login from './screens/Login';
import Groups from './screens/Groups';
import GroupForm from './screens/GroupForm';
import GroupDetails from './screens/GroupDetails';
import ShareToGroup from './screens/ShareToGroup';
import UnshareFromGroup from './screens/UnshareFromGroup';
import { enableSecureView, disableSecureView, forbidAndroidShare, allowAndroidShare } from 'react-native-prevent-screenshot-ios-android';
import { ConnectivityProvider } from './util/Connectivity';
import { ConnectivityContext } from './util/Connectivity';
import { Icon } from 'react-native-paper';

export type RootStackParamList = {
  Home: undefined;
  Login: undefined;
  Groups: undefined;
  GroupForm: { groupId?: string };
  GroupDetails: { groupId: string };
  ShareToGroup: { cardIds?: string[]; groupId?: string };
  UnshareFromGroup: { cardIds?: string[]; groupId?: string };
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
    <ConnectivityProvider>
      <NavigationContainer>
        <Stack.Navigator initialRouteName="Login">
          <Stack.Screen name="Home" component={Home} options={{
            headerLeft: () => (
              <>
                <Icon
                  source="circle-medium"
                  color={useContext(ConnectivityContext).isConnected ? "green" : "red"}
                  size={20}
                />
                <Text style={{ color: 'black' }}>{useContext(ConnectivityContext).isConnected ? 'Online' : 'Offline'}</Text>
              </>
            ),
            headerBackVisible: false,
            gestureEnabled: false,
            headerTitleAlign: 'center',
            headerStyle: { backgroundColor: '#F4F5F7' },
            statusBarColor: '#F4F5F7',
            statusBarStyle: 'dark'
          }} />
          <Stack.Screen name="Groups" component={Groups} />
          <Stack.Screen name="GroupForm" component={GroupForm} />
          <Stack.Screen name="GroupDetails" component={GroupDetails} />
          <Stack.Screen name="ShareToGroup" component={ShareToGroup} />
          <Stack.Screen name="UnshareFromGroup" component={UnshareFromGroup} />
          <Stack.Screen name="Login" component={Login} options={{
            // title: 'CWallet',
            // headerTitleAlign:'center',
            // headerTransparent: true,
            // headerTintColor: '#000000',
            // headerTitleStyle:{
            //   fontSize:20
            // }
            headerShown: false,
            gestureEnabled: false
          }} />
        </Stack.Navigator>
      </NavigationContainer>
    </ConnectivityProvider>
  )
}

export default App

