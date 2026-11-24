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
import { Card, CardGroupAccess, CardUserAccess, Group, SharedPerson } from '../types/Types';
import { fetchCardsByIds } from './cardService';
import { fetchGroup } from './groupService';
import { findRegisteredUser, getAppleUserId } from './userService';
import {
  accessDocId,
  userAccessDocId,
  validateRecipientIdentifier,
  isSelfRecipient,
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

const mapUserAccess = (id: string, data: any): CardUserAccess => ({
  accessId: id,
  cardId: data.cardId,
  recipientUid: data.recipientUid || null,
  recipientEmail: data.recipientEmail || '',
  recipientAppleId: data.recipientAppleId || null,
  recipientDisplayName: data.recipientDisplayName || '',
  sharedBy: data.sharedBy,
  sharedByEmail: data.sharedByEmail || '',
  sharedByName: data.sharedByName || '',
  sharedAt: data.sharedAt,
  status: data.status || 'active',
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

export const shareCardsWithGroups = async (
  cardIds: string[],
  groupIds: string[],
): Promise<{ shared: number; skipped: number }> => {
  const uniqueCardIds = uniqueIds(cardIds);
  const uniqueGroupIds = uniqueIds(groupIds);
  if (uniqueCardIds.length === 0) {
    throw new Error('Select at least one card.');
  }
  if (uniqueGroupIds.length === 0) {
    throw new Error('Select at least one group.');
  }

  let totalShared = 0;
  let totalSkipped = 0;

  for (const groupId of uniqueGroupIds) {
    const result = await shareCardsWithGroup(uniqueCardIds, groupId);
    totalShared += result.shared;
    totalSkipped += result.skipped;
  }

  return { shared: totalShared, skipped: totalSkipped };
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

export const unshareCardsFromGroups = async (
  cardIds: string[],
  groupIds: string[],
): Promise<number> => {
  const uniqueCardIds = uniqueIds(cardIds);
  const uniqueGroupIds = uniqueIds(groupIds);
  if (uniqueCardIds.length === 0 || uniqueGroupIds.length === 0) return 0;

  if (uniqueGroupIds.includes('__ALL__')) {
    return unshareCardsFromAllGroups(uniqueCardIds);
  }

  let totalCount = 0;
  for (const groupId of uniqueGroupIds) {
    const count = await unshareCardsFromGroup(uniqueCardIds, groupId);
    totalCount += count;
  }
  return totalCount;
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

/**
 * Shares one or more cards directly with an individual person by Email ID or Apple User ID.
 */
export const shareCardsWithPerson = async (
  cardIds: string[],
  recipientIdentifier: string,
): Promise<{ shared: number; skipped: number; isPending: boolean; recipientName: string }> => {
  const uid = requireUid();
  const currentUser = auth().currentUser;
  const currentEmail = currentUser?.email?.toLowerCase().trim() || '';
  const currentAppleId = getAppleUserId(currentUser);

  const validation = validateRecipientIdentifier(recipientIdentifier);
  if (!validation.isValid) {
    throw new Error('Please enter a valid email address or Apple user ID.');
  }

  // Prevent sharing with oneself
  if (
    isSelfRecipient(validation.normalized, { uid, email: currentEmail, appleUserId: currentAppleId }) ||
    isSelfRecipient(recipientIdentifier, { uid, email: currentEmail, appleUserId: currentAppleId })
  ) {
    throw new Error('You cannot share cards with yourself.');
  }

  const registered = await findRegisteredUser(validation.normalized);

  // Prevent sharing with oneself if registered profile points to current user
  if (registered && registered.uid === uid) {
    throw new Error('You cannot share cards with yourself.');
  }

  const uniqueCardIds = uniqueIds(cardIds);
  if (uniqueCardIds.length === 0) {
    throw new Error('Select at least one card.');
  }

  const recipientUid = registered?.uid || null;
  const recipientEmail = validation.isEmail ? validation.normalized : (registered?.email || '');
  const recipientAppleId = !validation.isEmail ? validation.normalized : (registered?.appleUserId || null);
  const recipientDisplayName = registered?.displayName || recipientEmail || recipientAppleId || 'User';
  const isPending = !recipientUid;
  const status: 'active' | 'pending' = isPending ? 'pending' : 'active';
  const recipientKey = recipientUid || `pending_${recipientEmail || recipientAppleId}`;

  const operations: string[] = [];
  let skipped = 0;

  for (const cardId of uniqueCardIds) {
    const cardSnap = await assertOwnsCard(cardId, uid);
    const data = cardSnap.data() || {};
    const existingUserIds: string[] = data.sharedUserIds || [];
    const existingEmails: string[] = data.sharedEmails || [];
    const existingAppleIds: string[] = data.sharedAppleIds || [];

    const alreadyShared =
      (recipientUid && existingUserIds.includes(recipientUid)) ||
      (recipientEmail && existingEmails.includes(recipientEmail)) ||
      (recipientAppleId && existingAppleIds.includes(recipientAppleId));

    if (alreadyShared) {
      skipped += 1;
    } else {
      operations.push(cardId);
    }
  }

  if (operations.length > 0) {
    const personObj: SharedPerson = {
      recipientUid: recipientUid || null,
      email: recipientEmail || '',
      appleUserId: recipientAppleId || null,
      displayName: recipientDisplayName,
    };

    for (const chunk of chunkArray(operations, 200)) {
      const batch = writeBatch(db());
      chunk.forEach((cardId) => {
        const accessId = userAccessDocId(cardId, recipientKey);
        batch.set(doc(db(), COLLECTIONS.CARD_USER_ACCESS, accessId), {
          cardId,
          recipientUid,
          recipientEmail,
          recipientAppleId,
          recipientDisplayName,
          sharedBy: uid,
          sharedByEmail: currentUser?.email || '',
          sharedByName: currentUser?.displayName || currentUser?.email || '',
          sharedAt: serverTimestamp(),
          status,
        });

        const cardUpdates: Record<string, any> = {
          sharedWithUsers: arrayUnion(personObj),
        };
        if (recipientUid) {
          cardUpdates.sharedUserIds = arrayUnion(recipientUid);
        }
        if (recipientEmail) {
          cardUpdates.sharedEmails = arrayUnion(recipientEmail);
        }
        if (recipientAppleId) {
          cardUpdates.sharedAppleIds = arrayUnion(recipientAppleId);
        }

        batch.update(doc(db(), COLLECTIONS.CARDS, cardId), cardUpdates);
      });
      await batch.commit();
    }
  }

  return {
    shared: operations.length,
    skipped,
    isPending,
    recipientName: recipientDisplayName,
  };
};

/**
 * Unshares one or more cards from an individual person.
 */
export const unshareCardsFromPerson = async (
  cardIds: string[],
  recipientKeyOrIdentifier: string,
): Promise<number> => {
  const uid = requireUid();
  const uniqueCardIds = uniqueIds(cardIds);
  if (uniqueCardIds.length === 0) return 0;

  const trimmed = recipientKeyOrIdentifier.trim();
  const normalizedKey = trimmed.toLowerCase();
  const isEmail = normalizedKey.includes('@');

  let unsharedCount = 0;

  for (const cardId of uniqueCardIds) {
    await assertOwnsCard(cardId, uid);
    const cardRef = doc(db(), COLLECTIONS.CARDS, cardId);
    const cardSnap = await getDoc(cardRef);
    if (!cardSnap.exists()) continue;

    const cardData = cardSnap.data() || {};

    // 1. Identify all matching person profiles on the card
    const currentUsers: SharedPerson[] = Array.isArray(cardData.sharedWithUsers) ? cardData.sharedWithUsers : [];
    const matchedEmails = new Set<string>();
    const matchedUids = new Set<string>();
    const matchedAppleIds = new Set<string>();

    if (isEmail) {
      matchedEmails.add(normalizedKey);
    } else {
      matchedUids.add(trimmed);
      matchedAppleIds.add(trimmed);
    }

    currentUsers.forEach((u) => {
      const emailMatches = u.email && u.email.toLowerCase().trim() === normalizedKey;
      const uidMatches = u.recipientUid && u.recipientUid === trimmed;
      const appleMatches = u.appleUserId && u.appleUserId === trimmed;
      if (emailMatches || uidMatches || appleMatches) {
        if (u.email) matchedEmails.add(u.email.toLowerCase().trim());
        if (u.recipientUid) matchedUids.add(u.recipientUid);
        if (u.appleUserId) matchedAppleIds.add(u.appleUserId);
      }
    });

    // 2. Query any cardUserAccess docs in Firestore for this card
    const qAccess = query(
      collection(db(), COLLECTIONS.CARD_USER_ACCESS),
      where('cardId', '==', cardId),
    );
    const accessSnap = await getDocs(qAccess);
    const accessDocsToDelete: any[] = [];

    accessSnap.docs.forEach((docSnap: any) => {
      const data = docSnap.data();
      const docEmail = data.recipientEmail?.toLowerCase()?.trim() || '';
      const docUid = data.recipientUid || '';
      const docApple = data.recipientAppleId || '';

      const isMatch =
        (docEmail && matchedEmails.has(docEmail)) ||
        (docUid && matchedUids.has(docUid)) ||
        (docApple && matchedAppleIds.has(docApple)) ||
        docSnap.id === userAccessDocId(cardId, trimmed) ||
        docSnap.id === userAccessDocId(cardId, `pending_${trimmed}`) ||
        (isEmail && docSnap.id === userAccessDocId(cardId, `pending_${normalizedKey}`));

      if (isMatch) {
        accessDocsToDelete.push(docSnap);
        if (docEmail) matchedEmails.add(docEmail);
        if (docUid) matchedUids.add(docUid);
        if (docApple) matchedAppleIds.add(docApple);
      }
    });

    // 3. Filter arrays in JS
    const filteredUsers = currentUsers.filter((u) => {
      const emailMatches = u.email && matchedEmails.has(u.email.toLowerCase().trim());
      const uidMatches = u.recipientUid && matchedUids.has(u.recipientUid);
      const appleMatches = u.appleUserId && matchedAppleIds.has(u.appleUserId);
      return !emailMatches && !uidMatches && !appleMatches;
    });

    const currentEmails: string[] = Array.isArray(cardData.sharedEmails) ? cardData.sharedEmails : [];
    const filteredEmails = currentEmails.filter(
      (e) => typeof e === 'string' && !matchedEmails.has(e.toLowerCase().trim()) && e.trim().length > 0,
    );

    const currentUserIds: string[] = Array.isArray(cardData.sharedUserIds) ? cardData.sharedUserIds : [];
    const filteredUserIds = currentUserIds.filter(
      (id) => typeof id === 'string' && !matchedUids.has(id) && id.trim().length > 0,
    );

    const currentAppleIds: string[] = Array.isArray(cardData.sharedAppleIds) ? cardData.sharedAppleIds : [];
    const filteredAppleIds = currentAppleIds.filter(
      (id) => typeof id === 'string' && !matchedAppleIds.has(id) && id.trim().length > 0,
    );

    // 4. Commit batch
    const batch = writeBatch(db());
    accessDocsToDelete.forEach((d: any) => {
      batch.delete(d.ref);
    });

    batch.update(cardRef, {
      sharedWithUsers: filteredUsers,
      sharedEmails: filteredEmails,
      sharedUserIds: filteredUserIds,
      sharedAppleIds: filteredAppleIds,
    });

    await batch.commit();
    unsharedCount++;
  }

  return unsharedCount;
};

/**
 * Unshares one or more cards from multiple individual people.
 */
export const unshareCardsFromPeople = async (
  cardIds: string[],
  recipientKeys: string[],
): Promise<number> => {
  let count = 0;
  for (const recipientKey of recipientKeys) {
    count += await unshareCardsFromPerson(cardIds, recipientKey);
  }
  return count;
};

/**
 * Listens for cards directly shared with the current user.
 */
export const listenAccessForUser = (
  uid: string,
  email: string,
  appleUserId: string | null,
  onChange: (access: CardUserAccess[]) => void,
  onError?: (error: Error) => void,
): (() => void) => {
  if (!uid) return () => {};

  const normEmail = email ? email.toLowerCase().trim() : '';

  // Listen by recipientUid
  const qUid = query(
    collection(db(), COLLECTIONS.CARD_USER_ACCESS),
    where('recipientUid', '==', uid),
  );

  let uidRecords: CardUserAccess[] = [];
  let emailRecords: CardUserAccess[] = [];

  const emit = () => {
    const map = new Map<string, CardUserAccess>();
    [...uidRecords, ...emailRecords].forEach((r) => map.set(r.accessId, r));
    onChange(Array.from(map.values()));
  };

  const unsubUid = onSnapshot(
    qUid,
    (snap) => {
      uidRecords = snap.docs.map((d: any) => mapUserAccess(d.id, d.data()));
      emit();
    },
    (err) => onError?.(err as Error),
  );

  let unsubEmail = () => {};
  if (normEmail) {
    const qEmail = query(
      collection(db(), COLLECTIONS.CARD_USER_ACCESS),
      where('recipientEmail', '==', normEmail),
    );
    unsubEmail = onSnapshot(
      qEmail,
      (snap) => {
        emailRecords = snap.docs.map((d: any) => mapUserAccess(d.id, d.data()));
        emit();
      },
      (err) => onError?.(err as Error),
    );
  }

  return () => {
    unsubUid();
    unsubEmail();
  };
};

/**
 * Listens for all cardUserAccess records created by the current user for their owned cards.
 * Enables seeing which individual people cards are currently shared with.
 */
export const listenPersonAccessForCards = (
  cardIds: string[],
  onChange: (records: CardUserAccess[]) => void,
  onError?: (error: Error) => void,
): (() => void) => {
  const uid = auth().currentUser?.uid;
  if (!uid || cardIds.length === 0) {
    onChange([]);
    return () => {};
  }

  const q = query(
    collection(db(), COLLECTIONS.CARD_USER_ACCESS),
    where('sharedBy', '==', uid),
  );

  return onSnapshot(
    q,
    (snap) => {
      const records = snap.docs
        .map((d: any) => mapUserAccess(d.id, d.data()))
        .filter((r: CardUserAccess) => cardIds.includes(r.cardId));
      onChange(records);
    },
    (err) => onError?.(err as Error),
  );
};

/**
 * Activates any pending 1-to-1 card shares when a user registers or logs in.
 */
export const activatePendingCardAccessForUser = async (): Promise<number> => {
  const currentUser = auth().currentUser;
  if (!currentUser?.uid) return 0;

  const email = currentUser.email ? currentUser.email.toLowerCase().trim() : '';
  const appleId = getAppleUserId(currentUser);

  let updatedCount = 0;

  if (email) {
    const pendingSnap = await getDocs(
      query(
        collection(db(), COLLECTIONS.CARD_USER_ACCESS),
        where('recipientEmail', '==', email),
        where('status', '==', 'pending'),
      ),
    );

    for (const docSnap of pendingSnap.docs) {
      const data = docSnap.data();
      const batch = writeBatch(db());
      batch.update(docSnap.ref, {
        recipientUid: currentUser.uid,
        status: 'active',
      });
      if (data.cardId) {
        batch.update(doc(db(), COLLECTIONS.CARDS, data.cardId), {
          sharedUserIds: arrayUnion(currentUser.uid),
        });
      }
      await batch.commit();
      updatedCount++;
    }
  }

  if (appleId) {
    const pendingSnap = await getDocs(
      query(
        collection(db(), COLLECTIONS.CARD_USER_ACCESS),
        where('recipientAppleId', '==', appleId),
        where('status', '==', 'pending'),
      ),
    );

    for (const docSnap of pendingSnap.docs) {
      const data = docSnap.data();
      const batch = writeBatch(db());
      batch.update(docSnap.ref, {
        recipientUid: currentUser.uid,
        status: 'active',
      });
      if (data.cardId) {
        batch.update(doc(db(), COLLECTIONS.CARDS, data.cardId), {
          sharedUserIds: arrayUnion(currentUser.uid),
        });
      }
      await batch.commit();
      updatedCount++;
    }
  }

  return updatedCount;
};
