import auth from '@react-native-firebase/auth';
import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from '@react-native-firebase/firestore';
import { getFirestore } from '@react-native-firebase/firestore';
import { COLLECTIONS, MAX_SHARED_GROUPS_PER_CARD } from '../constants/Firestore';
import { Card, CardGroupAccess, Group } from '../types/Types';
import { fetchCardsByIds } from './cardService';
import { fetchGroup } from './groupService';
import {
  accessDocId,
  assertShareGroupLimit,
  canShareToGroup,
  chunkArray,
  chunkForBatch,
  chunkForInQuery,
  uniqueIds,
} from './sharingUtils';

const db = () => getFirestore();

const requireUid = () => {
  const uid = auth().currentUser?.uid;
  if (!uid) {
    throw new Error('You must be signed in.');
  }
  return uid;
};

const mapAccess = (id: string, data: any): CardGroupAccess => ({
  accessId: id,
  cardId: data.cardId,
  groupId: data.groupId,
  sharedBy: data.sharedBy,
  sharedAt: data.sharedAt,
});

const assertOwnsCard = async (cardId: string, uid: string) => {
  const snapshot = await getDoc(doc(db(), COLLECTIONS.CARDS, cardId));
  if (!snapshot.exists()) {
    throw new Error('Card not found.');
  }
  if (snapshot.data()?.ownerId !== uid) {
    throw new Error('You can only share cards you own.');
  }
  return snapshot;
};

export const listenAccessForGroup = (
  groupId: string,
  onChange: (access: CardGroupAccess[]) => void,
  onError?: (error: Error) => void,
): (() => void) => {
  const accessQuery = query(
    collection(db(), COLLECTIONS.CARD_GROUP_ACCESS),
    where('groupId', '==', groupId),
  );
  return onSnapshot(
    accessQuery,
    (snapshot) => {
      onChange(snapshot.docs.map((accessDoc: any) => mapAccess(accessDoc.id, accessDoc.data())));
    },
    (error) => onError?.(error as Error),
  );
};

export const listenAccessForCard = (
  cardId: string,
  onChange: (access: CardGroupAccess[]) => void,
  onError?: (error: Error) => void,
): (() => void) => {
  const accessQuery = query(
    collection(db(), COLLECTIONS.CARD_GROUP_ACCESS),
    where('cardId', '==', cardId),
  );
  return onSnapshot(
    accessQuery,
    (snapshot) => {
      onChange(snapshot.docs.map((accessDoc: any) => mapAccess(accessDoc.id, accessDoc.data())));
    },
    (error) => onError?.(error as Error),
  );
};

export const listenAccessForGroups = (
  groupIds: string[],
  onChange: (access: CardGroupAccess[]) => void,
  onError?: (error: Error) => void,
): (() => void) => {
  const ids = uniqueIds(groupIds);
  if (ids.length === 0) {
    onChange([]);
    return () => {};
  }
  const unsubscribes: Array<() => void> = [];
  const accessById: Record<string, CardGroupAccess> = {};
  const emit = () => onChange(Object.values(accessById));

  chunkForInQuery(ids).forEach((chunk) => {
    const accessQuery = query(
      collection(db(), COLLECTIONS.CARD_GROUP_ACCESS),
      where('groupId', 'in', chunk),
    );
    unsubscribes.push(
      onSnapshot(
        accessQuery,
        (snapshot) => {
          snapshot.docChanges().forEach((change: any) => {
            if (change.type === 'removed') {
              delete accessById[change.doc.id];
            } else {
              accessById[change.doc.id] = mapAccess(change.doc.id, change.doc.data());
            }
          });
          if (snapshot.docChanges().length === 0) {
            snapshot.docs.forEach((accessDoc: any) => {
              accessById[accessDoc.id] = mapAccess(accessDoc.id, accessDoc.data());
            });
          }
          emit();
        },
        (error) => onError?.(error as Error),
      ),
    );
  });

  return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
};

export const shareCardsWithGroup = async (cardIds: string[], groupId: string): Promise<{ shared: number; skipped: number }> => {
  const uid = requireUid();
  const group = await fetchGroup(groupId);
  if (!canShareToGroup(group, uid)) {
    throw new Error(
      group.contributionPermission === 'owner_only'
        ? 'Only the group owner can share cards with this group.'
        : 'You must be a member of this group to share cards with it.',
    );
  }

  const uniqueCardIds = uniqueIds(cardIds);
  if (uniqueCardIds.length === 0) {
    throw new Error('Select at least one card.');
  }

  let shared = 0;
  let skipped = 0;
  const operations: Array<{ cardId: string; groupId: string }> = [];

  for (const cardId of uniqueCardIds) {
    const snapshot = await assertOwnsCard(cardId, uid);
    const sharedGroupIds: string[] = snapshot.data()?.sharedGroupIds || [];
    if (sharedGroupIds.includes(groupId)) {
      skipped += 1;
      continue;
    }
    assertShareGroupLimit(sharedGroupIds.length, 1);
    operations.push({ cardId, groupId });
  }

  for (const chunk of chunkForBatch(operations)) {
    const batch = writeBatch(db());
    chunk.forEach(({ cardId }) => {
      const accessId = accessDocId(cardId, groupId);
      batch.set(doc(db(), COLLECTIONS.CARD_GROUP_ACCESS, accessId), {
        cardId,
        groupId,
        sharedBy: uid,
        sharedAt: serverTimestamp(),
      });
      batch.update(doc(db(), COLLECTIONS.CARDS, cardId), {
        sharedGroupIds: arrayUnion(groupId),
      });
    });
    await batch.commit();
    shared += chunk.length;
  }

  return { shared, skipped };
};

export const syncCardGroupAccess = async (cardId: string, nextGroupIds: string[]): Promise<void> => {
  const uid = requireUid();
  await assertOwnsCard(cardId, uid);
  const desiredIds = uniqueIds(nextGroupIds);
  if (desiredIds.length > MAX_SHARED_GROUPS_PER_CARD) {
    throw new Error(`A card can be shared with at most ${MAX_SHARED_GROUPS_PER_CARD} groups.`);
  }

  const existingSnap = await getDocs(
    query(collection(db(), COLLECTIONS.CARD_GROUP_ACCESS), where('cardId', '==', cardId)),
  );
  const existingIds = existingSnap.docs.map((accessDoc: any) => accessDoc.data().groupId as string);
  const toAdd = desiredIds.filter((groupId: string) => !existingIds.includes(groupId));
  const toRemove = existingIds.filter((groupId: string) => !desiredIds.includes(groupId));

  for (const groupId of toAdd) {
    const group = await fetchGroup(groupId);
    if (!canShareToGroup(group, uid)) {
      throw new Error(`You cannot share this card with ${group.name}.`);
    }
  }

  const ops: Array<(activeBatch: ReturnType<typeof writeBatch>) => void> = [];
  toAdd.forEach((groupId: string) => {
    ops.push((activeBatch) => {
      activeBatch.set(doc(db(), COLLECTIONS.CARD_GROUP_ACCESS, accessDocId(cardId, groupId)), {
        cardId,
        groupId,
        sharedBy: uid,
        sharedAt: serverTimestamp(),
      });
      activeBatch.update(doc(db(), COLLECTIONS.CARDS, cardId), {
        sharedGroupIds: arrayUnion(groupId),
      });
    });
  });
  toRemove.forEach((groupId: string) => {
    ops.push((activeBatch) => {
      activeBatch.delete(doc(db(), COLLECTIONS.CARD_GROUP_ACCESS, accessDocId(cardId, groupId)));
      activeBatch.update(doc(db(), COLLECTIONS.CARDS, cardId), {
        sharedGroupIds: arrayRemove(groupId),
      });
    });
  });

  for (const chunk of chunkArray(ops, 200)) {
    const activeBatch = writeBatch(db());
    chunk.forEach((apply) => apply(activeBatch));
    await activeBatch.commit();
  }
};

export const unshareCardFromGroup = async (cardId: string, groupId: string): Promise<void> => {
  const uid = requireUid();
  await assertOwnsCard(cardId, uid);
  await deleteDoc(doc(db(), COLLECTIONS.CARD_GROUP_ACCESS, accessDocId(cardId, groupId)));
  const cardRef = doc(db(), COLLECTIONS.CARDS, cardId);
  const cardSnap = await getDoc(cardRef);
  if (cardSnap.exists()) {
    const activeBatch = writeBatch(db());
    activeBatch.update(cardRef, { sharedGroupIds: arrayRemove(groupId) });
    await activeBatch.commit();
  }
};

export const unshareCardsFromGroup = async (cardIds: string[], groupId: string): Promise<number> => {
  const uid = requireUid();
  const uniqueCardIds = uniqueIds(cardIds);
  if (uniqueCardIds.length === 0) return 0;

  for (const chunk of chunkArray(uniqueCardIds, 200)) {
    const batch = writeBatch(db());
    for (const cardId of chunk) {
      await assertOwnsCard(cardId, uid);
      const accessId = accessDocId(cardId, groupId);
      batch.delete(doc(db(), COLLECTIONS.CARD_GROUP_ACCESS, accessId));
      batch.update(doc(db(), COLLECTIONS.CARDS, cardId), {
        sharedGroupIds: arrayRemove(groupId),
      });
    }
    await batch.commit();
  }
  return uniqueCardIds.length;
};

export const unshareCardsFromAllGroups = async (cardIds: string[]): Promise<number> => {
  const uid = requireUid();
  let count = 0;
  for (const cardId of uniqueIds(cardIds)) {
    const cardSnap = await assertOwnsCard(cardId, uid);
    const sharedGroupIds: string[] = cardSnap.data()?.sharedGroupIds || [];
    if (sharedGroupIds.length === 0) continue;

    const accessSnap = await getDocs(
      query(collection(db(), COLLECTIONS.CARD_GROUP_ACCESS), where('cardId', '==', cardId)),
    );
    const batch = writeBatch(db());
    accessSnap.docs.forEach((docSnap: any) => batch.delete(docSnap.ref));
    batch.update(doc(db(), COLLECTIONS.CARDS, cardId), {
      sharedGroupIds: [],
    });
    await batch.commit();
    count++;
  }
  return count;
};

export const fetchAccessibleCards = async (
  accessRecords: CardGroupAccess[],
  groups: Group[],
): Promise<Card[]> => {
  const groupNameById = groups.reduce<Record<string, string>>((acc, group) => {
    acc[group.groupId] = group.name;
    return acc;
  }, {});
  const groupIdsByCard: Record<string, string[]> = {};
  accessRecords.forEach((record) => {
    if (!groupIdsByCard[record.cardId]) {
      groupIdsByCard[record.cardId] = [];
    }
    if (!groupIdsByCard[record.cardId].includes(record.groupId)) {
      groupIdsByCard[record.cardId].push(record.groupId);
    }
  });
  const cards = await fetchCardsByIds(Object.keys(groupIdsByCard));
  return cards.map((card) => ({
    ...card,
    accessGroupNames: (groupIdsByCard[card.key] || [])
      .map((groupId) => groupNameById[groupId])
      .filter(Boolean),
  }));
};
