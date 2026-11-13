import { View, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native'
import React, { useEffect, useRef, useState, useContext } from 'react'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { RootStackParamList } from '../App'
import { GoogleSignin } from '@react-native-google-signin/google-signin'
import auth from '@react-native-firebase/auth'
import { getFirestore, doc, getDoc } from '@react-native-firebase/firestore'
import { upsertCurrentUserProfile } from '../services/userService'
import { activatePendingMembershipsForUser } from '../services/groupService'
import { Text, Snackbar, Icon } from 'react-native-paper'
import { checkBiometricAvailability, authenticateWithBiometrics } from '../util/Biometric'
import { ConnectivityContext } from '../util/Connectivity'
import { WEB_CLIENT_ID } from '../constants/Constants'

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>

const Login: React.FC<Props> = ({ navigation }) => {
    const [loginDisabled, setLoginDisabled] = useState(false)
    const [visible, setVisible] = useState(false)
    const [errorMessage, setErrorMessage] = useState('Error signing in. Please try again.')
    const [checkingAuth, setCheckingAuth] = useState(true)
    const [isAlreadyLoggedIn, setIsAlreadyLoggedIn] = useState(false)
    const { isConnected } = useContext(ConnectivityContext)
    const isAuthenticatingRef = useRef(false)
    const isSigningInWithGoogle = useRef(false)

    useEffect(() => {
        GoogleSignin.configure({
            webClientId: WEB_CLIENT_ID
        })
    }, [])

    const handleBiometricLogin = async () => {
        if (isAuthenticatingRef.current) return
        isAuthenticatingRef.current = true
        try {
            const isBiometricAvailable = await checkBiometricAvailability()
            if (isBiometricAvailable) {
                console.log('Biometric available, attempting authentication')
                const isAuthenticated = await authenticateWithBiometrics()
                if (isAuthenticated) {
                    console.log('Biometric authentication successful, navigating to Home')
                    await upsertCurrentUserProfile()
                    await activatePendingMembershipsForUser()
                    navigation.reset({
                        index: 0,
                        routes: [{ name: 'Home' }],
                    })
                    return
                } else {
                    console.log('Biometric authentication failed or cancelled')
                }
            } else {
                console.log('Biometric not available on device, proceeding to Home for signed-in user')
                await upsertCurrentUserProfile()
                await activatePendingMembershipsForUser()
                navigation.reset({
                    index: 0,
                    routes: [{ name: 'Home' }],
                })
                return
            }
        } catch (error) {
            console.error('Error during biometric authentication:', error)
        } finally {
            isAuthenticatingRef.current = false
            setCheckingAuth(false)
        }
    }

    useEffect(() => {
        let isMounted = true

        const unsubscribe = auth().onAuthStateChanged(async (currentUser) => {
            if (!isMounted) return
            if (isSigningInWithGoogle.current) return

            if (currentUser) {
                console.log('User is already logged in:', currentUser.email)
                setIsAlreadyLoggedIn(true)
                await handleBiometricLogin()
            } else {
                console.log('No user logged in, showing Google login')
                setIsAlreadyLoggedIn(false)
                setCheckingAuth(false)
            }
        })

        return () => {
            isMounted = false
            unsubscribe()
        }
    }, [])

    const signInWithGoogle = async () => {
        try {
            isSigningInWithGoogle.current = true
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
                const db = getFirestore()
                const accessDoc = await getDoc(doc(db, 'accessList', currentUser.email))
                if (accessDoc.exists()) {
                    console.log('User has access, navigating to Home')
                    await upsertCurrentUserProfile()
                    await activatePendingMembershipsForUser()
                    navigation.reset({
                        index: 0,
                        routes: [{ name: 'Home' }],
                    })
                } else {
                    console.log('User does not have access')
                    await auth().signOut()
                    await GoogleSignin.signOut()
                    setIsAlreadyLoggedIn(false)
                    setErrorMessage('You do not have access to CWallet.')
                    setVisible(true)
                }
            }
        } catch (error) {
            console.error('Google Sign-In Error:', error)
            setErrorMessage('Error signing in. Please try again.')
            setVisible(true)
        } finally {
            setLoginDisabled(false)
            isSigningInWithGoogle.current = false
        }
    }

    const onDismissSnackBar = () => setVisible(false)

    return (
        <View style={styles.container}>
            <Text style={styles.title}>CWallet</Text>
            <Text style={styles.description}>Welcome to CWallet{'\n'}Best digital wallet you can keep!</Text>

            {checkingAuth ? (
                <ActivityIndicator size="large" color="#4285F4" style={styles.loader} />
            ) : (
                <View style={styles.buttonContainer}>
                    {isAlreadyLoggedIn && (
                        <TouchableOpacity
                            style={styles.biometricButton}
                            onPress={handleBiometricLogin}
                            disabled={loginDisabled}
                        >
                            <Icon source="fingerprint" size={24} color="white" />
                            <Text style={styles.biometricButtonText}>Unlock with Biometrics</Text>
                        </TouchableOpacity>
                    )}

                    <TouchableOpacity
                        style={[styles.button, isAlreadyLoggedIn && styles.secondaryButton]}
                        onPress={signInWithGoogle}
                        disabled={loginDisabled || !isConnected}
                    >
                        <Text style={[styles.buttonText, isAlreadyLoggedIn && styles.secondaryButtonText]}>
                            {isAlreadyLoggedIn ? 'Sign in with another account' : 'Sign in with Google'}
                        </Text>
                    </TouchableOpacity>
                </View>
            )}

            <Snackbar
                visible={visible}
                onDismiss={onDismissSnackBar}
                action={{
                    label: 'Dismiss',
                    onPress: onDismissSnackBar,
                }}>
                {errorMessage}
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
        backgroundColor: '#F4F5F7',
        paddingHorizontal: 24,
    },
    title: {
        fontSize: 32,
        fontWeight: 'bold',
        marginBottom: 20,
    },
    description: {
        fontSize: 16,
        textAlign: 'center',
        marginBottom: 30,
        color: '#666',
    },
    loader: {
        marginTop: 20,
    },
    buttonContainer: {
        width: '100%',
        alignItems: 'center',
    },
    biometricButton: {
        backgroundColor: '#0F9D58',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderRadius: 8,
        width: '80%',
        marginBottom: 16,
    },
    biometricButtonText: {
        color: 'white',
        fontSize: 16,
        fontWeight: 'bold',
        marginLeft: 8,
    },
    button: {
        backgroundColor: '#4285F4',
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderRadius: 8,
        width: '80%',
        alignItems: 'center',
    },
    buttonText: {
        color: 'white',
        fontSize: 16,
        fontWeight: 'bold',
    },
    secondaryButton: {
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: '#4285F4',
    },
    secondaryButtonText: {
        color: '#4285F4',
    },
})
