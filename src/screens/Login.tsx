import { View, Text, TouchableOpacity, StyleSheet, Image } from 'react-native'
import React from 'react'

import { NativeStackScreenProps } from '@react-navigation/native-stack';

import { RootStackParamList } from '../App'

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

const Login: React.FC<Props> = ({ navigation }) => {
    return (
        <View style={styles.container}>
            <View style={styles.imageContainer}>
                <Image source={require('../assets/images/login.png')} style={styles.loginImage}></Image>
            </View>
            <Text style={styles.description}>Welcome to CWallet{'\n'}Best digital wallet you can keep!</Text>
            <TouchableOpacity style={styles.button} onPress={() => navigation.navigate('Home')}><Text style={styles.buttonText}>Google Login</Text></TouchableOpacity>
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