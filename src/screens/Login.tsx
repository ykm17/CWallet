import { View, Text, TouchableOpacity, StyleSheet, Image } from 'react-native'
import React, { useContext } from 'react'
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../App'

import { GoogleSignin } from '@react-native-google-signin/google-signin';
import auth, { FirebaseAuthTypes } from '@react-native-firebase/auth';
import { useEffect, useState } from 'react';
import { ENV, WEB_CLIENT_ID } from '../constants/Constants';
import ReactNativeBiometrics, { BiometryTypes } from 'react-native-biometrics';
import { ConnectivityContext } from '../util/Connectivity';
import { Snackbar } from 'react-native-paper';
import database from '@react-native-firebase/database';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

const Login: React.FC<Props> = ({ navigation }) => {

    const reference = database().ref(ENV + '/accessList');
    const [user, setUser] = useState<FirebaseAuthTypes.User | null>(null);
    const [loginDisabled, setLoginDisabled] = useState(false);
    const isConnected = useContext(ConnectivityContext).isConnected;
    const [visible, setVisible] = React.useState(false);

    const onDismissSnackBar = () => setVisible(false);
    useEffect(() => {
        GoogleSignin.configure({
            webClientId: WEB_CLIENT_ID,  // from Firebase Console
        });
    }, []);

    useEffect(() => {
        setVisible(!isConnected);
    }, [isConnected]);

    // Check if the user is already signed in
    useEffect(() => {
        const unsubscribe = auth().onAuthStateChanged((currentUser) => {
            if (currentUser) {
                // User is signed in
                setUser(currentUser);
                //temporary access check.
                const onValueChange = reference.on('value', async (snapshot) => {
                    const data = snapshot.val(); // Get the data from snapshot
                    console.log("Logger: ", data);
                    if (data) {
                        let cardList: any[] = [];
                        Object.keys(data).forEach(eachkey => {
                            let card = data[eachkey];
                            cardList.push(card);
                        });

                        console.log("Logger: ", cardList);
                        if (cardList.includes(currentUser.email)) {
                            checkBiometricAvailability();
                        } else {
                            setVisible(true);
                            // Sign out from Firebase
                            await auth().signOut();
                            // Sign out from Google
                            await GoogleSignin.signOut();
                            setLoginDisabled(false);
                        }

                    }
                });
                //check biometric
                console.log('User is signed in:', currentUser);
            } else {
                // No user is signed in
                setLoginDisabled(false);
                console.log('No user is signed in');
                setUser(null);
            }
        });

        // Cleanup subscription on unmount
        return () => unsubscribe();
    }, []);

    const rnBiometrics = new ReactNativeBiometrics();

    // Check if biometric authentication is available
    const checkBiometricAvailability = () => {
        rnBiometrics.isSensorAvailable()
            .then((result) => {
                const { available, biometryType } = result;

                if (available && biometryType === BiometryTypes.TouchID) {
                    console.log('TouchID is available');
                } else if (available && biometryType === BiometryTypes.FaceID) {
                    console.log('FaceID is available');
                } else if (available && biometryType === BiometryTypes.Biometrics) {
                    console.log('Biometrics are available');
                } else {
                    console.log('Biometric authentication not supported');
                    navigation.replace('Home');
                    return;
                }
                handleBiometricLogin();

            })
            .catch((error) => {
                console.log(error);
            });
    };

    // Trigger biometric authentication
    const handleBiometricLogin = () => {
        console.log("\n\nYASH 1\n\n");
        rnBiometrics.simplePrompt({ promptMessage: 'Authenticate' })
            .then((result) => {

                console.log("\n\nYASH 2\n\n", result);
                const { success } = result;

                if (success) {
                    console.log('Biometric authentication successful');
                    // Proceed to login or main screen
                    navigation.replace('Home');

                } else {
                    console.log('Biometric authentication failed');
                }
            })
            .catch(() => {
                console.log('Biometric authentication error');
            });
    };

    const signInWithGoogle = async (): Promise<boolean> => {
        try {
            // Check if your device supports Google Play
            await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
            // Get the users ID token
            const response = await GoogleSignin.signIn();

            const idToken = response?.data?.idToken;

            if (!idToken) {
                throw new Error('Google Sign-In failed: No idToken returned.');
            }
            // Create a Google credential with the token
            const googleCredential = auth.GoogleAuthProvider.credential(idToken);

            await auth().signInWithCredential(googleCredential);

            // Sign-in the user with the credential
            return true;
        } catch (error) {
            console.error('Google sign-in error', error);
            return false;
        }
    };

    const handleSignIn = async () => {
        setLoginDisabled(true);
        let isUserAuthenticated = await signInWithGoogle();
        console.log("LOGGER IS AUTH: ", isUserAuthenticated);
        if (!isUserAuthenticated) {
            setLoginDisabled(false);
        }
    }

    return (
        <View style={styles.container}>
            <View style={styles.imageContainer}>
                <Image source={require('../assets/images/login.png')} style={styles.loginImage}></Image>
            </View>
            <Text style={styles.title}>CWallet</Text>

            <Text style={styles.description}>Welcome to CWallet{'\n'}Best digital wallet you can keep!</Text>

            <TouchableOpacity style={styles.button} onPress={handleSignIn} disabled={loginDisabled || !isConnected}><Text style={styles.buttonText}>Google Login</Text></TouchableOpacity>

            <Snackbar
                visible={visible}
                onDismiss={onDismissSnackBar}
                action={{
                    label: 'Close',
                    onPress: () => {
                        setVisible(false);
                    },
                }}
            >
                {isConnected ? "Access Denied." : "Internet not available, please try later!"}
            </Snackbar>
        </View>
    )
}

export default Login

const styles = StyleSheet.create({
    container: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#ffffff'
    },
    button: {
        alignItems: 'center',
        backgroundColor: 'black',
        padding: 16,
        borderRadius: 20,
    },
    buttonText: {
        color: '#ffffff'
    },
    description: {
        color: 'black',
        marginBottom: 30,
        textAlign: 'center',
        fontSize: 20,
        fontWeight: '600'
    },
    title: {
        color: 'black',
        marginBottom: 30,
        textAlign: 'center',
        fontSize: 25,
        fontWeight: '600'
    },
    loginImage: {
        width: 300,
        height: 300,
        margin: 10,
    },
    imageContainer: {
        elevation: 10, // Android
        shadowColor: '#000', // iOS
        shadowOffset: { width: 0, height: 5 }, // iOS
        shadowOpacity: 0.3, // iOS
        shadowRadius: 10, // iOS
    }
})

