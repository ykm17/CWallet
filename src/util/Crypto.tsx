// cryptoUtils.ts
import 'react-native-get-random-values';
import CryptoJS from 'crypto-js';
import { Card } from '../types/Types';
import { CARD_ENCRYPTION_SECRET_KEY } from '@env';

// Define the secret key
const SECRET_KEY = CARD_ENCRYPTION_SECRET_KEY;

// Encrypt function
export const encryptCardData = (cardData: Card): string => {
    try {
        // Convert card data to a JSON string
        const cardDataString = JSON.stringify(cardData);

        // Encrypt the JSON string
        const encrypted = CryptoJS.AES.encrypt(cardDataString, SECRET_KEY).toString();
        
        return encrypted; // Return encrypted data as a string
    } catch (error) {
        console.error('Error encrypting card data:', error);
    }
    return "";
};

// Decrypt function
export const decryptCardData = (encryptedData: string): Card | null => {
    try {
        // Decrypt the string
        const bytes = CryptoJS.AES.decrypt(encryptedData, SECRET_KEY);

        // Convert the decrypted bytes back to a string
        const decryptedString = bytes.toString(CryptoJS.enc.Utf8);

        // Parse the string back to a JSON object
        const cardData: Card = JSON.parse(decryptedString);

        return cardData; // Return the decrypted card data
    } catch (error) {
        console.error('Error decrypting card data:', error);
    }
    return null
};
