import { View, Text, TouchableOpacity, StyleSheet, Image } from 'react-native'
import React from 'react'
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../App'

import { GoogleSignin } from '@react-native-google-signin/google-signin';
import auth, { FirebaseAuthTypes } from '@react-native-firebase/auth';
import { useEffect, useState } from 'react';
import { WEB_CLIENT_ID } from '../constants/Constants';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

const Login: React.FC<Props> = ({ navigation }) => {

    const [user, setUser] = useState<FirebaseAuthTypes.User | null>(null);

    useEffect(() => {
        GoogleSignin.configure({
            webClientId: WEB_CLIENT_ID,  // from Firebase Console
        });
    }, []);

    // Check if the user is already signed in
    useEffect(() => {
        const unsubscribe = auth().onAuthStateChanged((currentUser) => {
            if (currentUser) {
                // User is signed in
                setUser(currentUser);
                navigation.replace('Home');
                console.log('User is signed in:', currentUser);
            } else {
                // No user is signed in
                console.log('No user is signed in');
                setUser(null);
            }
        });

        // Cleanup subscription on unmount
        return () => unsubscribe();
    }, []);


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
        let isUserAuthenticated = await signInWithGoogle();
        if (isUserAuthenticated) {
            navigation.replace('Home');
        }
    }

    return (
        <View style={styles.container}>
            <View style={styles.imageContainer}>
                <Image source={require('../assets/images/login.png')} style={styles.loginImage}></Image>
            </View>
            <Text style={styles.description}>Welcome to CWallet{'\n'}Best digital wallet you can keep!</Text>
            <TouchableOpacity style={styles.button} onPress={handleSignIn}><Text style={styles.buttonText}>Google Login</Text></TouchableOpacity>
            {/* () => navigation.navigate('Home') */}
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
        backgroundColor: '#3D5AFE',
        padding: 15,
        borderRadius: 10,
    },
    buttonText: {
        color: '#ffffff'
    },
    description: {
        color: '#2196F3',
        marginBottom: 30,
        textAlign: 'center',
        fontSize: 20,
        fontWeight: '600'
    },
    loginImage: {
        width: 300,
        height: 300,
        margin: 10,
        marginBottom: 30,
    },
    imageContainer: {
        elevation: 10, // Android
        shadowColor: '#000', // iOS
        shadowOffset: { width: 0, height: 5 }, // iOS
        shadowOpacity: 0.3, // iOS
        shadowRadius: 10, // iOS
    }
})

