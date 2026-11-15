import { AppState, Platform } from 'react-native';
import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Home from './screens/Home';
import Login from './screens/Login';
import Profile from './screens/Profile';
import Groups from './screens/Groups';
import GroupForm from './screens/GroupForm';
import GroupDetails from './screens/GroupDetails';
import ShareToGroup from './screens/ShareToGroup';
import UnshareFromGroup from './screens/UnshareFromGroup';
import { enableSecureView, disableSecureView, forbidAndroidShare, allowAndroidShare } from 'react-native-prevent-screenshot-ios-android';
import { ConnectivityProvider } from './util/Connectivity';
import { PrivacyProvider } from './util/PrivacyContext';
import CustomAlertHost from './components/CustomAlert';
import { hideCardOverlay } from './services/cardOverlayService';

export type RootStackParamList = {
  Home: undefined;
  Login: undefined;
  Profile: undefined;
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

    // When the user opens the app or returns to it, automatically close the overlay
    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        hideCardOverlay();
      }
    });

    // Optional: Clean up by allowing screenshots on component unmount
    return () => {
      appStateSub.remove();
      if (Platform.OS === 'android') {
        allowAndroidShare(); // Re-enables screenshot and sharing on Android
      } else if (Platform.OS === 'ios') {
        disableSecureView(); // Re-enables screenshot on iOS
      }
    };
  }, []);
  return (
    <SafeAreaProvider>
      <ConnectivityProvider>
        <PrivacyProvider>
          <NavigationContainer>
            <Stack.Navigator
              initialRouteName="Login"
              screenOptions={{
                headerStyle: { backgroundColor: '#F4F5F7' },
                headerShadowVisible: false,
                headerTitleAlign: 'center',
                headerTitleStyle: {
                  fontWeight: '700',
                  fontSize: 17,
                  color: '#111111',
                },
                headerTintColor: '#111111',
                statusBarColor: '#F4F5F7',
                statusBarStyle: 'dark',
              }}
            >
              <Stack.Screen
                name="Home"
                component={Home}
                options={{
                  headerShown: false,
                  gestureEnabled: false,
                }}
              />
              <Stack.Screen name="Groups" component={Groups} />
              <Stack.Screen name="Profile" component={Profile} options={{ title: 'Profile' }} />
              <Stack.Screen name="GroupForm" component={GroupForm} />
              <Stack.Screen name="GroupDetails" component={GroupDetails} />
              <Stack.Screen name="ShareToGroup" component={ShareToGroup} />
              <Stack.Screen name="UnshareFromGroup" component={UnshareFromGroup} />
              <Stack.Screen
                name="Login"
                component={Login}
                options={{
                  headerShown: false,
                  gestureEnabled: false,
                }}
              />
            </Stack.Navigator>
          </NavigationContainer>
          <CustomAlertHost />
        </PrivacyProvider>
      </ConnectivityProvider>
    </SafeAreaProvider>
  );
};

export default App;

