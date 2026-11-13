import { describe, it, expect } from '@jest/globals';
import { accessDocId, canShareToGroup, uniqueIds } from '../src/services/sharingUtils';
import { CONTRIBUTION } from '../src/constants/Firestore';
import { Group } from '../src/types/Types';

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
});
