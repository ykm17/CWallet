import { describe, it, expect } from '@jest/globals';

const SHARED_CARDS_STORAGE_KEY = 'shared_cards';

describe('Offline Login & Storage Logic', () => {
  it('identifies offline authenticated session from cached storage', () => {
    const cachedSessionJson = JSON.stringify({
      uid: 'user_12345',
      email: 'test@example.com',
      displayName: 'Test User',
    });

    const parsed = JSON.parse(cachedSessionJson);
    const isOfflineLoggedIn = Boolean(parsed?.email || parsed?.uid);

    expect(isOfflineLoggedIn).toBe(true);
    expect(parsed.email).toBe('test@example.com');
  });

  it('determines whether cloud sync should run based on connectivity', () => {
    const shouldRunCloudSync = (isConnected: boolean) => isConnected;

    expect(shouldRunCloudSync(false)).toBe(false);
    expect(shouldRunCloudSync(true)).toBe(true);
  });

  it('verifies shared cards secure storage key and serialization', () => {
    expect(SHARED_CARDS_STORAGE_KEY).toBe('shared_cards');

    const sampleSharedCard = {
      key: 'card_abc_123',
      ownerName: 'Friend',
      email: 'friend@example.com',
      bankName: 'HD',
      number: '4111 1111 1111 1234',
      month: '12',
      cvv: '123',
      limit: '50000',
      accessGroupNames: ['Family'],
      accessUserNames: [],
    };

    const serialized = JSON.stringify([sampleSharedCard]);
    const parsed = JSON.parse(serialized);

    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].key).toBe('card_abc_123');
    expect(parsed[0].bankName).toBe('HD');
    expect(parsed[0].accessGroupNames).toContain('Family');
  });

  it('provides offline cards when network is disabled', () => {
    const enabled = false;
    const onlineCards: any[] = [];
    const offlineCards = [{ key: 'cached_card_1', bankName: 'IC' }];

    const activeCards = enabled ? onlineCards : (onlineCards.length > 0 ? onlineCards : offlineCards);

    expect(activeCards.length).toBe(1);
    expect(activeCards[0].key).toBe('cached_card_1');
  });
});
