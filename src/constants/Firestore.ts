export const COLLECTIONS = {
  CARDS: 'cards',
  GROUPS: 'groups',
  MEMBERS: 'members',
  CARD_GROUP_ACCESS: 'cardGroupAccess',
  USERS: 'users',
  ACCESS_LIST: 'accessList',
} as const;

export const CONTRIBUTION = {
  OPEN: 'open' as const,
  OWNER_ONLY: 'owner_only' as const,
};

export const MEMBER_ROLE = {
  OWNER: 'owner' as const,
  MEMBER: 'member' as const,
};

export const MEMBER_STATUS = {
  ACTIVE: 'active' as const,
  PENDING: 'pending' as const,
};

export const MAX_SHARED_GROUPS_PER_CARD = 20;
export const FIRESTORE_BATCH_LIMIT = 400;
export const FIRESTORE_IN_QUERY_LIMIT = 10;
