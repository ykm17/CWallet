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
});
