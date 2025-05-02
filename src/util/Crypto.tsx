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
        console.log("Encrypting card data:", cardData);
        // Convert card data to a JSON string
        const cardDataString = JSON.stringify(cardData);
        console.log("Card data string:", cardDataString);

        // Encrypt the JSON string
        const encrypted = CryptoJS.AES.encrypt(cardDataString, SECRET_KEY).toString();
        console.log("Encrypted data:", encrypted);
        
        return encrypted; // Return encrypted data as a string
    } catch (error) {
        console.error('Error encrypting card data:', error);
    }
    return "";
};

// Decrypt function
export const decryptCardData = (encryptedData: string): Card | null => {
    try {
        console.log("Decrypting data:", encryptedData);
        // Decrypt the string
        const bytes = CryptoJS.AES.decrypt(encryptedData, SECRET_KEY);
        console.log("Decrypted bytes:", bytes);

        // Convert the decrypted bytes back to a string
        const decryptedString = bytes.toString(CryptoJS.enc.Utf8);
        console.log("Decrypted string:", decryptedString);

        // Parse the string back to a JSON object
        const cardData: Card = JSON.parse(decryptedString);
        console.log("Decrypted card data:", cardData);

        return cardData; // Return the decrypted card data
    } catch (error) {
        console.error('Error decrypting card data:', error);
    }
    return null;
};
