import auth from '@react-native-firebase/auth';
import { getFirestore, collection, doc, getDoc, getDocs, query, where, writeBatch } from '@react-native-firebase/firestore';
import { COLLECTIONS } from '../constants/Firestore';
import { Card } from '../types/Types';
import { decryptCardData } from '../util/Crypto';
import { chunkForBatch, sortCardsByLatest, toTimestampMillis } from './sharingUtils';

const db = () => getFirestore();

export const parseCardDocument = (snapshotDoc: any): Card | null => {
  const data = snapshotDoc.data();
  if (!data?.encryptedData) {
    return null;
  }
  try {
    const decryptedCard = decryptCardData(data.encryptedData);
    if (!decryptedCard) {
      return null;
    }
    const rawAddedAt =
      data.addedAt ??
      data.createdAt ??
      decryptedCard.addedAt ??
      decryptedCard.createdAt ??
      (snapshotDoc.metadata?.hasPendingWrites ? Date.now() : null);

    const addedAt = toTimestampMillis(rawAddedAt) || undefined;

    return {
      ...decryptedCard,
      key: snapshotDoc.id,
      ownerId: data.ownerId,
      sharedGroupIds: data.sharedGroupIds || [],
      isPersonal: decryptedCard.isPersonal ?? true,
      addedAt,
      createdAt: addedAt,
    };
  } catch (error) {
    console.error('Error decrypting card:', snapshotDoc.id, error);
    return null;
  }
};

export const fetchCardsByIds = async (cardIds: string[]): Promise<Card[]> => {
  const uniqueIds = Array.from(new Set(cardIds.filter(Boolean)));
  const cards: Card[] = [];
  await Promise.all(
    uniqueIds.map(async (cardId) => {
      try {
        const snapshot = await getDoc(doc(db(), COLLECTIONS.CARDS, cardId));
        if (!snapshot.exists()) {
          return;
        }
        const card = parseCardDocument(snapshot);
        if (card) {
          cards.push(card);
        }
      } catch (error) {
        console.error('Unable to read card', cardId, error);
      }
    }),
  );
  return sortCardsByLatest(cards);
};

export const deleteOwnedCard = async (cardId: string): Promise<void> => {
  const uid = auth().currentUser?.uid;
  if (!uid) {
    throw new Error('You must be signed in.');
  }
  const cardRef = doc(db(), COLLECTIONS.CARDS, cardId);
  const cardSnap = await getDoc(cardRef);
  if (!cardSnap.exists()) {
    return;
  }
  if (cardSnap.data()?.ownerId !== uid) {
    throw new Error('Only the original owner can delete this card.');
  }

  const accessSnap = await getDocs(
    query(collection(db(), COLLECTIONS.CARD_GROUP_ACCESS), where('cardId', '==', cardId)),
  );
  const refsToDelete = [cardRef, ...accessSnap.docs.map((accessDoc: any) => accessDoc.ref)];
  for (const chunk of chunkForBatch(refsToDelete)) {
    const batch = writeBatch(db());
    chunk.forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
};
