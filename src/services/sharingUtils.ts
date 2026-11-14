import { FIRESTORE_BATCH_LIMIT, FIRESTORE_IN_QUERY_LIMIT, MAX_SHARED_GROUPS_PER_CARD } from '../constants/Firestore';
import { Card, ContributionPermission, Group } from '../types/Types';

export const accessDocId = (cardId: string, groupId: string): string => `${cardId}_${groupId}`;

export const userAccessDocId = (cardId: string, recipientKey: string): string => `${cardId}_${recipientKey}`;

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export interface RecipientValidation {
  isValid: boolean;
  isEmail: boolean;
  type: 'email' | 'appleId' | 'unknown';
  identifier: string;
  normalized: string;
  error?: string;
}

export const validateRecipientIdentifier = (
  input: string,
): RecipientValidation => {
  const trimmed = input.trim();
  if (!trimmed) {
    return {
      isValid: false,
      isEmail: false,
      type: 'unknown',
      identifier: '',
      normalized: '',
      error: 'Please enter an Email address or Apple ID.',
    };
  }
  if (trimmed.includes('@')) {
    const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
    const normalized = trimmed.toLowerCase();
    return {
      isValid: isEmailValid,
      isEmail: true,
      type: 'email',
      identifier: normalized,
      normalized,
      error: isEmailValid ? undefined : 'Please enter a valid email address (e.g., name@example.com).',
    };
  }
  // Apple User Identifier (typically format like 001234.abcdef or alphanumeric string >= 5 chars without spaces)
  const isAppleIdValid = trimmed.length >= 5 && !/\s/.test(trimmed);
  return {
    isValid: isAppleIdValid,
    isEmail: false,
    type: 'appleId',
    identifier: trimmed,
    normalized: trimmed,
    error: isAppleIdValid
      ? undefined
      : 'Please enter a valid Apple User ID (alphanumeric, at least 5 characters).',
  };
};

/**
 * Checks whether a given identifier refers to the current user (self).
 */
export const isSelfRecipient = (
  identifier: string,
  user?: { uid?: string; email?: string | null; appleUserId?: string | null } | null,
): boolean => {
  if (!identifier || !user) return false;
  const trimmed = identifier.trim();
  const normalized = trimmed.toLowerCase();
  if (user.uid && (trimmed === user.uid || normalized === user.uid.toLowerCase())) {
    return true;
  }
  if (user.email && normalized === normalizeEmail(user.email)) {
    return true;
  }
  if (user.appleUserId && trimmed === user.appleUserId.trim()) {
    return true;
  }
  return false;
};

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

/**
 * Normalizes any timestamp representation (Firestore Timestamp, Date, string, seconds, millis)
 * into a millisecond number. Returns 0 if invalid or empty.
 */
export const toTimestampMillis = (val: any): number => {
  if (!val) return 0;
  if (typeof val === 'number') {
    return val > 1e8 && val < 1e11 ? val * 1000 : val;
  }
  if (typeof val.toMillis === 'function') {
    try {
      return val.toMillis();
    } catch {
      return 0;
    }
  }
  if (typeof val.toDate === 'function') {
    try {
      return val.toDate().getTime();
    } catch {
      return 0;
    }
  }
  if (val.seconds !== undefined && typeof val.seconds === 'number') {
    return val.seconds * 1000 + Math.floor((val.nanoseconds || 0) / 1000000);
  }
  if (val._seconds !== undefined && typeof val._seconds === 'number') {
    return val._seconds * 1000 + Math.floor((val._nanoseconds || 0) / 1000000);
  }
  if (val instanceof Date) {
    return val.getTime();
  }
  if (typeof val === 'string') {
    const parsed = Date.parse(val);
    if (!isNaN(parsed)) return parsed;
    const num = Number(val);
    if (!isNaN(num)) return num > 1e8 && num < 1e11 ? num * 1000 : num;
  }
  return 0;
};

/**
 * Returns the highest relevant timestamp for sorting a card (addedAt, createdAt, or sharedAt).
 */
export const getCardSortTimestamp = (card?: Partial<Card> | null): number => {
  if (!card) return 0;
  const added = toTimestampMillis(card.addedAt);
  const created = toTimestampMillis(card.createdAt);
  const shared = toTimestampMillis(card.sharedAt);
  return Math.max(added, created, shared);
};

/**
 * Sorts cards in descending order (latest card added/shared at top).
 */
export const sortCardsByLatest = <T extends Partial<Card>>(cards: T[]): T[] => {
  return [...cards].sort((a, b) => getCardSortTimestamp(b) - getCardSortTimestamp(a));
};
