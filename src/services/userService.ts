import auth, { FirebaseAuthTypes } from '@react-native-firebase/auth';
import { getFirestore, collection, doc, getDoc, getDocs, query, setDoc, where, limit, serverTimestamp } from '@react-native-firebase/firestore';
import { COLLECTIONS } from '../constants/Firestore';
import { WalletUser } from '../types/Types';
import { normalizeEmail } from './sharingUtils';

const db = () => getFirestore();

const mapUser = (id: string, data: any): WalletUser => ({
  uid: data?.uid || id,
  email: data?.email || '',
  displayName: data?.displayName || '',
  photoURL: data?.photoURL || '',
  appleUserId: data?.appleUserId || null,
});

export const getAppleUserId = (user: FirebaseAuthTypes.User | null): string | null => {
  const appleProvider = user?.providerData?.find((provider) => provider.providerId === 'apple.com');
  return appleProvider?.uid || null;
};

export const upsertCurrentUserProfile = async (): Promise<void> => {
  const user = auth().currentUser;
  if (!user) {
    return;
  }
  const email = user.email ? normalizeEmail(user.email) : '';
  await setDoc(
    doc(db(), COLLECTIONS.USERS, user.uid),
    {
      uid: user.uid,
      email,
      displayName: user.displayName || '',
      photoURL: user.photoURL || '',
      appleUserId: getAppleUserId(user),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
};

export const findUserByEmail = async (email: string): Promise<WalletUser | null> => {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return null;
  }
  const snapshot = await getDocs(
    query(collection(db(), COLLECTIONS.USERS), where('email', '==', normalized), limit(1)),
  );
  if (snapshot.empty) {
    return null;
  }
  const userDoc = snapshot.docs[0];
  return mapUser(userDoc.id, userDoc.data());
};

export const findUserByAppleId = async (appleUserId: string): Promise<WalletUser | null> => {
  const identifier = appleUserId.trim();
  if (!identifier) {
    return null;
  }
  const snapshot = await getDocs(
    query(collection(db(), COLLECTIONS.USERS), where('appleUserId', '==', identifier), limit(1)),
  );
  if (snapshot.empty) {
    return null;
  }
  const userDoc = snapshot.docs[0];
  return mapUser(userDoc.id, userDoc.data());
};

export const isValidEmail = (email: string): boolean => {
  const trimmed = email.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
};

export const findRegisteredUser = async (identifier: string): Promise<WalletUser | null> => {
  const value = identifier.trim();
  if (!value) {
    return null;
  }
  if (value.includes('@')) {
    return findUserByEmail(value);
  }
  return findUserByAppleId(value);
};

export const hasAccessListEntry = async (email: string): Promise<boolean> => {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return false;
  }
  try {
    const accessDoc = await getDoc(doc(db(), COLLECTIONS.ACCESS_LIST, normalized));
    if (accessDoc.exists()) {
      return true;
    }
    const original = email.trim();
    if (original !== normalized) {
      const originalDoc = await getDoc(doc(db(), COLLECTIONS.ACCESS_LIST, original));
      if (originalDoc.exists()) {
        return true;
      }
    }
    // Check if stored as field 'email' in any document
    const querySnapshot = await getDocs(
      query(collection(db(), COLLECTIONS.ACCESS_LIST), where('email', '==', normalized), limit(1)),
    );
    if (!querySnapshot.empty) {
      return true;
    }
  } catch (error) {
    console.warn('Error reading accessList:', error);
  }
  return false;
};
