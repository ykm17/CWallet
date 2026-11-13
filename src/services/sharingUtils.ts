import { FIRESTORE_BATCH_LIMIT, FIRESTORE_IN_QUERY_LIMIT, MAX_SHARED_GROUPS_PER_CARD } from '../constants/Firestore';
import { ContributionPermission, Group } from '../types/Types';

export const accessDocId = (cardId: string, groupId: string): string => `${cardId}_${groupId}`;

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export const chunkArray = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

export const chunkForInQuery = <T>(items: T[]): T[][] => chunkArray(items, FIRESTORE_IN_QUERY_LIMIT);

export const chunkForBatch = <T>(items: T[]): T[][] => chunkArray(items, FIRESTORE_BATCH_LIMIT);

export const canShareToGroup = (
  group: Group,
  userId: string,
): boolean => {
  const isMember = group.memberIds?.includes(userId);
  if (!isMember) {
    return false;
  }
  if (group.ownerId === userId) {
    return true;
  }
  return group.contributionPermission === 'open';
};

export const canManageGroup = (group: Group, userId: string): boolean => group.ownerId === userId;

export const uniqueIds = (ids: string[]): string[] => Array.from(new Set(ids.filter(Boolean)));

export const contributionLabel = (permission: ContributionPermission): string =>
  permission === 'owner_only' ? 'Owner-controlled' : 'Open contribution';

export const assertShareGroupLimit = (currentCount: number, addingCount: number) => {
  if (currentCount + addingCount > MAX_SHARED_GROUPS_PER_CARD) {
    throw new Error(`A card can be shared with at most ${MAX_SHARED_GROUPS_PER_CARD} groups.`);
  }
};
