import { describe, it, expect } from '@jest/globals';
import {
  accessDocId,
  canShareToGroup,
  uniqueIds,
  toTimestampMillis,
  getCardSortTimestamp,
  sortCardsByLatest,
  userAccessDocId,
  validateRecipientIdentifier,
  isSelfRecipient,
} from '../src/services/sharingUtils';
import { CONTRIBUTION } from '../src/constants/Firestore';
import { Group, Card } from '../src/types/Types';

const group = (overrides: Partial<Group> = {}): Group => ({
  groupId: 'g1',
  name: 'Family',
  ownerId: 'owner',
  contributionPermission: CONTRIBUTION.OPEN,
  memberIds: ['owner', 'member'],
  memberCount: 2,
  ...overrides,
});

describe('sharing helpers', () => {
  it('creates a deterministic access document id', () => {
    expect(accessDocId('cardA', 'groupB')).toBe('cardA_groupB');
  });

  it('creates a deterministic user access document id', () => {
    expect(userAccessDocId('card123', 'alice@example.com')).toBe('card123_alice@example.com');
    expect(userAccessDocId('card123', 'pending_bob@example.com')).toBe('card123_pending_bob@example.com');
  });

  describe('validateRecipientIdentifier', () => {
    it('validates and normalizes valid email addresses', () => {
      const res = validateRecipientIdentifier('  Alice@Example.COM  ');
      expect(res.isValid).toBe(true);
      expect(res.type).toBe('email');
      expect(res.identifier).toBe('alice@example.com');
      expect(res.error).toBeUndefined();
    });

    it('rejects malformed email addresses', () => {
      const res1 = validateRecipientIdentifier('alice@');
      expect(res1.isValid).toBe(false);
      expect(res1.error).toBeDefined();

      const res2 = validateRecipientIdentifier('abc');
      expect(res2.isValid).toBe(false);
      expect(res2.error).toContain('Apple');
    });

    it('recognizes valid Apple user identifiers', () => {
      const appleId = '001234.abcdef1234567890abcdef.1234';
      const res = validateRecipientIdentifier(`  ${appleId}  `);
      expect(res.isValid).toBe(true);
      expect(res.type).toBe('appleId');
      expect(res.identifier).toBe(appleId);
    });

    it('handles empty or blank input', () => {
      const res = validateRecipientIdentifier('   ');
      expect(res.isValid).toBe(false);
      expect(res.identifier).toBe('');
      expect(res.error).toBe('Please enter an Email address or Apple ID.');
    });
  });

  describe('isSelfRecipient', () => {
    const user = {
      uid: 'user_123',
      email: 'user@example.com',
      appleUserId: '001234.abcdef.1234',
    };

    it('identifies self when matching email address case-insensitively', () => {
      expect(isSelfRecipient('user@example.com', user)).toBe(true);
      expect(isSelfRecipient('  USER@Example.COM  ', user)).toBe(true);
    });

    it('identifies self when matching Apple user identifier', () => {
      expect(isSelfRecipient('001234.abcdef.1234', user)).toBe(true);
      expect(isSelfRecipient('  001234.abcdef.1234  ', user)).toBe(true);
    });

    it('identifies self when matching uid', () => {
      expect(isSelfRecipient('user_123', user)).toBe(true);
    });

    it('returns false for other recipients', () => {
      expect(isSelfRecipient('other@example.com', user)).toBe(false);
      expect(isSelfRecipient('009999.xyz.5678', user)).toBe(false);
      expect(isSelfRecipient('other_uid', user)).toBe(false);
    });

    it('returns false for null or undefined input', () => {
      expect(isSelfRecipient('', user)).toBe(false);
      expect(isSelfRecipient('user@example.com', null)).toBe(false);
      expect(isSelfRecipient('user@example.com', undefined)).toBe(false);
    });
  });

  it('deduplicates card ids', () => {
    expect(uniqueIds(['a', 'a', 'b', ''])).toEqual(['a', 'b']);
  });

  it('lets members share in open contribution mode', () => {
    expect(canShareToGroup(group(), 'member')).toBe(true);
  });

  it('blocks members from sharing in owner-controlled mode', () => {
    expect(canShareToGroup(group({ contributionPermission: CONTRIBUTION.OWNER_ONLY }), 'member')).toBe(false);
  });

  it('lets owners share in owner-controlled mode', () => {
    expect(canShareToGroup(group({ contributionPermission: CONTRIBUTION.OWNER_ONLY }), 'owner')).toBe(true);
  });

  it('correctly computes mapping pairs for multiple cards across multiple groups', () => {
    const cardIds = ['c1', 'c2'];
    const groupIds = ['g1', 'g2', 'g3'];
    const cards = [
      { key: 'c1', sharedGroupIds: ['g1'] },
      { key: 'c2', sharedGroupIds: [] },
    ];

    const pairs: Array<{ cardId: string; groupId: string }> = [];
    for (const cardId of cardIds) {
      const card = cards.find((c) => c.key === cardId);
      const cardSharedGroupIds = card?.sharedGroupIds || [];
      for (const groupId of groupIds) {
        if (!cardSharedGroupIds.includes(groupId)) {
          pairs.push({ cardId, groupId });
        }
      }
    }

    // c1 is already in g1, so c1 gets (c1, g2), (c1, g3) = 2
    // c2 gets (c2, g1), (c2, g2), (c2, g3) = 3
    // Total = 5 new pairs
    expect(pairs).toHaveLength(5);
    expect(pairs).toEqual([
      { cardId: 'c1', groupId: 'g2' },
      { cardId: 'c1', groupId: 'g3' },
      { cardId: 'c2', groupId: 'g1' },
      { cardId: 'c2', groupId: 'g2' },
      { cardId: 'c2', groupId: 'g3' },
    ]);
  });

  describe('timestamp normalization and latest card sorting', () => {
    it('normalizes various timestamp formats correctly', () => {
      expect(toTimestampMillis(null)).toBe(0);
      expect(toTimestampMillis(undefined)).toBe(0);
      expect(toTimestampMillis(0)).toBe(0);
      expect(toTimestampMillis(1731500000000)).toBe(1731500000000);
      expect(toTimestampMillis(1731500000)).toBe(1731500000000); // seconds converted to millis
      expect(toTimestampMillis({ toMillis: () => 1731500000123 })).toBe(1731500000123);
      expect(toTimestampMillis({ seconds: 1731500000, nanoseconds: 500000000 })).toBe(1731500000500);
      expect(toTimestampMillis({ _seconds: 1731500000, _nanoseconds: 250000000 })).toBe(1731500000250);
      expect(toTimestampMillis(new Date('2026-11-13T10:00:00.000Z'))).toBe(Date.parse('2026-11-13T10:00:00.000Z'));
      expect(toTimestampMillis('2026-11-13T10:00:00.000Z')).toBe(Date.parse('2026-11-13T10:00:00.000Z'));
    });

    it('extracts maximum relevant sort timestamp for a card', () => {
      const cardA: Partial<Card> = { addedAt: 1000, sharedAt: 5000 };
      expect(getCardSortTimestamp(cardA)).toBe(5000);

      const cardB: Partial<Card> = { addedAt: 8000 };
      expect(getCardSortTimestamp(cardB)).toBe(8000);

      expect(getCardSortTimestamp(null)).toBe(0);
    });

    it('sorts cards in descending order so latest card added/shared is at the top', () => {
      const cardOld: Partial<Card> = { key: 'old', addedAt: 1000 };
      const cardMid: Partial<Card> = { key: 'mid', addedAt: 2000 };
      const cardNew: Partial<Card> = { key: 'new', addedAt: 3000 };
      const cardSharedRecently: Partial<Card> = { key: 'shared', addedAt: 500, sharedAt: 4000 };

      const unsorted = [cardOld, cardNew, cardMid, cardSharedRecently];
      const sorted = sortCardsByLatest(unsorted);

      expect(sorted.map((c) => c.key)).toEqual(['shared', 'new', 'mid', 'old']);
    });
  });
});
