import { View, StyleSheet, TouchableOpacity } from 'react-native'
import React, { useEffect, useState } from 'react'
import { useNavigation } from '@react-navigation/native'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { RootStackParamList } from '../App'
import { GoogleSignin } from '@react-native-google-signin/google-signin'
import auth from '@react-native-firebase/auth'
import firestore from '@react-native-firebase/firestore'
import { Text, Snackbar } from 'react-native-paper'
import { checkBiometricAvailability, authenticateWithBiometrics } from '../util/Biometric'
import { ConnectivityContext } from '../util/Connectivity'
import { WEB_CLIENT_ID } from '../constants/Constants'

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>

const Login: React.FC<Props> = () => {
    const navigation = useNavigation()
    const [loginDisabled, setLoginDisabled] = useState(false)
    const [visible, setVisible] = useState(false)
    const { isConnected } = React.useContext(ConnectivityContext)

    useEffect(() => {
        GoogleSignin.configure({
            webClientId: WEB_CLIENT_ID
        })
    }, [])

    useEffect(() => {
        checkUserAuthStatus()
    }, [])

    const checkUserAuthStatus = async () => {
        try {
            const currentUser = auth().currentUser
            if (currentUser) {
                console.log('User is already logged in, checking biometric availability')
                const isBiometricAvailable = await checkBiometricAvailability()
                if (isBiometricAvailable) {
                    console.log('Biometric available, attempting authentication')
                    const isAuthenticated = await authenticateWithBiometrics()
                    if (isAuthenticated) {
                        console.log('Biometric authentication successful')
                        navigation.navigate('Home' as never)
                    } else {
                        console.log('Biometric authentication failed')
                        // User can still use Google login
                    }
                } else {
                    console.log('Biometric not available, showing Google login')
                }
            } else {
                console.log('No user logged in, showing Google login')
            }
        } catch (error) {
            console.error('Error checking user auth status:', error)
        }
    }

    const signInWithGoogle = async () => {
        try {
            setLoginDisabled(true)
            // Check if you have already signed in
            const hasPlayServices = await GoogleSignin.hasPlayServices()
            if (!hasPlayServices) {
                throw new Error('Google Play Services not available')
            }

            // Sign in with Google
            await GoogleSignin.signIn()

            // Get the users ID token
            const { idToken } = await GoogleSignin.getTokens()

            // Create a Google credential with the token
            const googleCredential = auth.GoogleAuthProvider.credential(idToken)

            // Sign-in the user with the credential
            const userCredential = await auth().signInWithCredential(googleCredential)
            const currentUser = userCredential.user

            if (currentUser?.email) {
                const accessDoc = await firestore().collection('accessList').doc(currentUser.email).get()
                if (accessDoc.exists) {
                    console.log('User has access, navigating to Home')
                    navigation.navigate('Home' as never)
                } else {
                    console.log('User does not have access')
                    await auth().signOut()
                    await GoogleSignin.signOut()
                    setVisible(true)
                }
            }
        } catch (error) {
            console.error('Google Sign-In Error:', error)
            setVisible(true)
        } finally {
            setLoginDisabled(false)
        }
    }

    const onDismissSnackBar = () => setVisible(false)

    return (
        <View style={styles.container}>
            <Text style={styles.title}>CWallet</Text>
            <Text style={styles.description}>Welcome to CWallet{'\n'}Best digital wallet you can keep!</Text>

            <TouchableOpacity 
                style={styles.button} 
                onPress={signInWithGoogle} 
                disabled={loginDisabled || !isConnected}
            >
                <Text style={styles.buttonText}>Sign in with Google</Text>
            </TouchableOpacity>

            <Snackbar
                visible={visible}
                onDismiss={onDismissSnackBar}
                action={{
                    label: 'Dismiss',
                    onPress: onDismissSnackBar,
                }}>
                Error signing in. Please try again.
            </Snackbar>
        </View>
    )
}

export default Login

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'white'
    },
    title: {
        fontSize: 32,
        fontWeight: 'bold',
        marginBottom: 20
    },
    description: {
        fontSize: 16,
        textAlign: 'center',
        marginBottom: 30
    },
    button: {
        backgroundColor: '#4285F4',
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 5,
        marginTop: 20
    },
    buttonText: {
        color: 'white',
        fontSize: 16,
        fontWeight: 'bold'
    }
})

