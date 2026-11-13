export interface Card {
    ownerName: string,
    bankName: string,
    number: string,
    month: string,
    year: string,
    cvv: string,
    name: string,
    limit: string,
    key: string,
    isPersonal: boolean,
    email: string,
    network?: string,
    cardType?: string,
    ownerId?: string,
    sharedGroupIds?: string[],
    accessGroupNames?: string[],
    addedAt?: any,
    createdAt?: any,
    sharedAt?: any,
}

export type ContributionPermission = 'open' | 'owner_only';

export type GroupRole = 'owner' | 'member';

export type MemberStatus = 'active' | 'pending';

export interface WalletUser {
    uid: string,
    email: string,
    displayName: string,
    photoURL: string,
    appleUserId?: string | null,
}

export interface Group {
    groupId: string,
    name: string,
    ownerId: string,
    contributionPermission: ContributionPermission,
    memberIds: string[],
    memberCount: number,
    createdAt?: any,
    updatedAt?: any,
}

export interface GroupMember {
    userId: string,
    email: string,
    displayName: string,
    role: GroupRole,
    status: MemberStatus,
    appleUserId?: string | null,
    joinedAt?: any,
}

export interface CardGroupAccess {
    accessId: string,
    cardId: string,
    groupId: string,
    sharedBy: string,
    sharedAt?: any,
}

// Define the dictionary type
export type BankDictionary = {
    [key: string]: string;
};