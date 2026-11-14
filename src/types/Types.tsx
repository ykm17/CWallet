export interface SharedPerson {
    recipientUid?: string | null;
    email?: string;
    appleUserId?: string | null;
    displayName?: string;
    status?: 'active' | 'pending';
}

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
    sharedUserIds?: string[],
    sharedEmails?: string[],
    sharedAppleIds?: string[],
    sharedWithUsers?: SharedPerson[],
    accessGroupNames?: string[],
    accessUserNames?: string[],
    sharedByInfo?: {
        name?: string;
        email?: string;
    },
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

export interface CardUserAccess {
    accessId: string,
    cardId: string,
    recipientUid?: string | null,
    recipientEmail?: string,
    recipientAppleId?: string | null,
    recipientDisplayName?: string,
    sharedBy: string,
    sharedByEmail?: string,
    sharedByName?: string,
    sharedAt?: any,
    status: 'active' | 'pending',
}

// Define the dictionary type
export type BankDictionary = {
    [key: string]: string;
};