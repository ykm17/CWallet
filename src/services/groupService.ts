import auth from '@react-native-firebase/auth';
import {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from '@react-native-firebase/firestore';
import { getFirestore } from '@react-native-firebase/firestore';
import { COLLECTIONS, CONTRIBUTION, MEMBER_ROLE, MEMBER_STATUS } from '../constants/Firestore';
import { ContributionPermission, Group, GroupMember, WalletUser } from '../types/Types';
import { chunkForBatch, normalizeEmail } from './sharingUtils';
import { findRegisteredUser, findUserByEmail, hasAccessListEntry, isValidEmail } from './userService';

const db = () => getFirestore();

const mapGroup = (id: string, data: any): Group => ({
  groupId: id,
  name: data?.name || '',
  ownerId: data?.ownerId || '',
  contributionPermission: data?.contributionPermission === CONTRIBUTION.OWNER_ONLY
    ? CONTRIBUTION.OWNER_ONLY
    : CONTRIBUTION.OPEN,
  memberIds: data?.memberIds || [],
  memberCount: data?.memberCount || (data?.memberIds || []).length,
  createdAt: data?.createdAt,
  updatedAt: data?.updatedAt,
});

const requireUid = () => {
  const uid = auth().currentUser?.uid;
  if (!uid) {
    throw new Error('You must be signed in.');
  }
  return uid;
};

const assertOwner = (group: Group, uid: string) => {
  if (group.ownerId !== uid) {
    throw new Error('Only the group owner can manage this group.');
  }
};

export const createGroup = async (
  name: string,
  contributionPermission: ContributionPermission = CONTRIBUTION.OPEN,
): Promise<string> => {
  const user = auth().currentUser;
  const uid = requireUid();
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error('Group name is required.');
  }

  const groupRef = doc(collection(db(), COLLECTIONS.GROUPS));
  const batch = writeBatch(db());
  batch.set(groupRef, {
    name: trimmedName,
    ownerId: uid,
    contributionPermission,
    memberIds: [uid],
    memberCount: 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(db(), COLLECTIONS.GROUPS, groupRef.id, COLLECTIONS.MEMBERS, uid), {
    userId: uid,
    email: user?.email || '',
    displayName: user?.displayName || '',
    role: MEMBER_ROLE.OWNER,
    status: MEMBER_STATUS.ACTIVE,
    appleUserId: user?.providerData?.find((provider) => provider.providerId === 'apple.com')?.uid || null,
    joinedAt: serverTimestamp(),
  });
  await batch.commit();
  return groupRef.id;
};

export const updateGroup = async (
  groupId: string,
  updates: { name?: string; contributionPermission?: ContributionPermission },
): Promise<void> => {
  const uid = requireUid();
  const group = await fetchGroup(groupId);
  assertOwner(group, uid);
  const payload: Record<string, any> = { updatedAt: serverTimestamp() };
  if (typeof updates.name === 'string') {
    const trimmedName = updates.name.trim();
    if (!trimmedName) {
      throw new Error('Group name is required.');
    }
    payload.name = trimmedName;
  }
  if (updates.contributionPermission) {
    payload.contributionPermission = updates.contributionPermission;
  }
  await updateDoc(doc(db(), COLLECTIONS.GROUPS, groupId), payload);
};

export const fetchGroup = async (groupId: string): Promise<Group> => {
  const snapshot = await getDoc(doc(db(), COLLECTIONS.GROUPS, groupId));
  if (!snapshot.exists()) {
    throw new Error('Group not found.');
  }
  return mapGroup(snapshot.id, snapshot.data());
};

export interface AddMemberResult {
  user?: WalletUser;
  isPending: boolean;
  email: string;
}

export const addMemberToGroup = async (groupId: string, identifier: string): Promise<AddMemberResult> => {
  const uid = requireUid();
  const group = await fetchGroup(groupId);
  assertOwner(group, uid);

  const trimmed = identifier.trim();
  if (!trimmed) {
    throw new Error('Please enter an email address or Apple user ID.');
  }

  const currentEmail = auth().currentUser?.email?.toLowerCase().trim();
  if (currentEmail && normalizeEmail(trimmed) === currentEmail) {
    throw new Error('You are already the owner of this group.');
  }

  const user = await findRegisteredUser(trimmed);
  if (user) {
    if (user.uid === uid) {
      throw new Error('You are already the owner of this group.');
    }
    if (group.memberIds.includes(user.uid)) {
      throw new Error('This user is already a member of the group.');
    }

    const batch = writeBatch(db());
    batch.set(doc(db(), COLLECTIONS.GROUPS, groupId, COLLECTIONS.MEMBERS, user.uid), {
      userId: user.uid,
      email: user.email,
      displayName: user.displayName || user.email.split('@')[0],
      role: MEMBER_ROLE.MEMBER,
      status: MEMBER_STATUS.ACTIVE,
      appleUserId: user.appleUserId || null,
      joinedAt: serverTimestamp(),
    });
    batch.update(doc(db(), COLLECTIONS.GROUPS, groupId), {
      memberIds: arrayUnion(user.uid),
      memberCount: increment(1),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    return { user, isPending: false, email: user.email };
  }

  // User not yet registered in 'users' collection
  if (trimmed.includes('@')) {
    if (!isValidEmail(trimmed)) {
      throw new Error('Please enter a valid email address.');
    }
    const normalizedEmail = normalizeEmail(trimmed);
    const pendingId = `pending_${normalizedEmail}`;

    if (group.memberIds.includes(pendingId)) {
      throw new Error('An invitation has already been added for this email.');
    }

    const batch = writeBatch(db());
    batch.set(doc(db(), COLLECTIONS.GROUPS, groupId, COLLECTIONS.MEMBERS, pendingId), {
      userId: pendingId,
      email: normalizedEmail,
      displayName: normalizedEmail.split('@')[0],
      role: MEMBER_ROLE.MEMBER,
      status: MEMBER_STATUS.PENDING,
      joinedAt: serverTimestamp(),
    });
    batch.update(doc(db(), COLLECTIONS.GROUPS, groupId), {
      memberIds: arrayUnion(pendingId),
      memberCount: increment(1),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    return { isPending: true, email: normalizedEmail };
  }

  throw new Error('No CWallet account was found for that Apple ID.');
};

export const activatePendingMembershipsForUser = async (): Promise<number> => {
  const currentUser = auth().currentUser;
  if (!currentUser?.email || !currentUser?.uid) {
    return 0;
  }
  const email = normalizeEmail(currentUser.email);
  const pendingId = `pending_${email}`;

  try {
    const groupsSnap = await getDocs(
      query(collection(db(), COLLECTIONS.GROUPS), where('memberIds', 'array-contains', pendingId)),
    );
    if (groupsSnap.empty) {
      return 0;
    }

    let count = 0;
    for (const groupDoc of groupsSnap.docs) {
      const groupId = groupDoc.id;
      const batch = writeBatch(db());

      batch.set(doc(db(), COLLECTIONS.GROUPS, groupId, COLLECTIONS.MEMBERS, currentUser.uid), {
        userId: currentUser.uid,
        email,
        displayName: currentUser.displayName || email.split('@')[0],
        role: MEMBER_ROLE.MEMBER,
        status: MEMBER_STATUS.ACTIVE,
        appleUserId: currentUser.providerData?.find((p) => p.providerId === 'apple.com')?.uid || null,
        joinedAt: serverTimestamp(),
      });
      batch.delete(doc(db(), COLLECTIONS.GROUPS, groupId, COLLECTIONS.MEMBERS, pendingId));
      batch.update(doc(db(), COLLECTIONS.GROUPS, groupId), {
        memberIds: arrayRemove(pendingId),
        updatedAt: serverTimestamp(),
      });
      batch.update(doc(db(), COLLECTIONS.GROUPS, groupId), {
        memberIds: arrayUnion(currentUser.uid),
      });

      await batch.commit();
      count++;
    }
    return count;
  } catch (error) {
    console.warn('Could not auto-activate pending group memberships:', error);
    return 0;
  }
};

export const upgradePendingMembersIfRegistered = async (
  groupId: string,
  members: GroupMember[],
): Promise<void> => {
  const pendingMembers = members.filter((m) => m.status === MEMBER_STATUS.PENDING && m.email);
  if (pendingMembers.length === 0) {
    return;
  }

  for (const pending of pendingMembers) {
    try {
      const registered = await findUserByEmail(pending.email);
      if (registered && registered.uid) {
        const batch = writeBatch(db());
        batch.set(doc(db(), COLLECTIONS.GROUPS, groupId, COLLECTIONS.MEMBERS, registered.uid), {
          userId: registered.uid,
          email: registered.email,
          displayName: registered.displayName || registered.email.split('@')[0],
          role: MEMBER_ROLE.MEMBER,
          status: MEMBER_STATUS.ACTIVE,
          appleUserId: registered.appleUserId || null,
          joinedAt: pending.joinedAt || serverTimestamp(),
        });
        batch.delete(doc(db(), COLLECTIONS.GROUPS, groupId, COLLECTIONS.MEMBERS, pending.userId));
        batch.update(doc(db(), COLLECTIONS.GROUPS, groupId), {
          memberIds: arrayRemove(pending.userId),
          updatedAt: serverTimestamp(),
        });
        batch.update(doc(db(), COLLECTIONS.GROUPS, groupId), {
          memberIds: arrayUnion(registered.uid),
        });
        await batch.commit();
      }
    } catch (error) {
      console.warn('Error upgrading pending member:', pending.email, error);
    }
  }
};

export const removeMemberFromGroup = async (groupId: string, userId: string): Promise<void> => {
  const uid = requireUid();
  const group = await fetchGroup(groupId);
  assertOwner(group, uid);
  if (userId === group.ownerId) {
    throw new Error('The group owner cannot be removed.');
  }
  const batch = writeBatch(db());
  batch.delete(doc(db(), COLLECTIONS.GROUPS, groupId, COLLECTIONS.MEMBERS, userId));
  batch.update(doc(db(), COLLECTIONS.GROUPS, groupId), {
    memberIds: arrayRemove(userId),
    memberCount: increment(-1),
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
};

export const deleteGroup = async (groupId: string): Promise<void> => {
  const uid = requireUid();
  const group = await fetchGroup(groupId);
  assertOwner(group, uid);

  const membersSnap = await getDocs(collection(db(), COLLECTIONS.GROUPS, groupId, COLLECTIONS.MEMBERS));
  const accessSnap = await getDocs(
    query(collection(db(), COLLECTIONS.CARD_GROUP_ACCESS), where('groupId', '==', groupId)),
  );

  const refs = [
    ...membersSnap.docs.map((memberDoc: any) => memberDoc.ref),
    ...accessSnap.docs.map((accessDoc: any) => accessDoc.ref),
    doc(db(), COLLECTIONS.GROUPS, groupId),
  ];
  for (const chunk of chunkForBatch(refs)) {
    const batch = writeBatch(db());
    chunk.forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
};

export const listenUserGroups = (
  onChange: (groups: Group[]) => void,
  onError?: (error: Error) => void,
): (() => void) => {
  const uid = auth().currentUser?.uid;
  if (!uid) {
    onChange([]);
    return () => {};
  }
  const groupsQuery = query(
    collection(db(), COLLECTIONS.GROUPS),
    where('memberIds', 'array-contains', uid),
  );
  return onSnapshot(
    groupsQuery,
    (snapshot) => {
      const groups = snapshot.docs.map((groupDoc: any) => mapGroup(groupDoc.id, groupDoc.data()));
      groups.sort((a: Group, b: Group) => a.name.localeCompare(b.name));
      onChange(groups);
    },
    (error) => onError?.(error as Error),
  );
};

export const listenGroup = (
  groupId: string,
  onChange: (group: Group | null) => void,
  onError?: (error: Error) => void,
): (() => void) => {
  return onSnapshot(
    doc(db(), COLLECTIONS.GROUPS, groupId),
    (snapshot) => {
      if (!snapshot.exists()) {
        onChange(null);
        return;
      }
      onChange(mapGroup(snapshot.id, snapshot.data()));
    },
    (error) => onError?.(error as Error),
  );
};

export const listenGroupMembers = (
  groupId: string,
  onChange: (members: GroupMember[]) => void,
  onError?: (error: Error) => void,
): (() => void) => {
  return onSnapshot(
    collection(db(), COLLECTIONS.GROUPS, groupId, COLLECTIONS.MEMBERS),
    (snapshot) => {
      const members: GroupMember[] = snapshot.docs.map((memberDoc: any) => {
        const data = memberDoc.data();
        return {
          userId: data.userId || memberDoc.id,
          email: data.email || '',
          displayName: data.displayName || '',
          role: data.role === MEMBER_ROLE.OWNER ? MEMBER_ROLE.OWNER : MEMBER_ROLE.MEMBER,
          status: data.status === MEMBER_STATUS.PENDING ? MEMBER_STATUS.PENDING : MEMBER_STATUS.ACTIVE,
          appleUserId: data.appleUserId || null,
          joinedAt: data.joinedAt,
        };
      });
      members.sort((a, b) => {
        if (a.role !== b.role) {
          return a.role === MEMBER_ROLE.OWNER ? -1 : 1;
        }
        return (a.displayName || a.email).localeCompare(b.displayName || b.email);
      });
      onChange(members);
    },
    (error) => onError?.(error as Error),
  );
};
