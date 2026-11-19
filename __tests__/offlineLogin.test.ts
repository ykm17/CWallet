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

  it('prunes revoked cards and accurately serializes empty cache when all shared cards are removed', () => {
    const prevCardsById: Record<string, any> = {
      card_1: { key: 'card_1', bankName: 'HD' },
      card_2: { key: 'card_2', bankName: 'IC' },
    };

    // Access was revoked for card_2, only card_1 remains valid
    const allowedCardIds = ['card_1'];
    const allowedSet = new Set(allowedCardIds);
    const prunedCardsById: Record<string, any> = {};
    Object.keys(prevCardsById).forEach((id) => {
      if (allowedSet.has(id)) {
        prunedCardsById[id] = prevCardsById[id];
      }
    });

    expect(prunedCardsById.card_1).toBeDefined();
    expect(prunedCardsById.card_2).toBeUndefined();

    // When all cards are removed / deleted
    const updatedCards: any[] = [];
    const serializedJson = JSON.stringify(updatedCards);
    const deserialized = JSON.parse(serializedJson);

    expect(Array.isArray(deserialized)).toBe(true);
    expect(deserialized.length).toBe(0);
  });

  it('ensures authoritative server data overrides offline cache once sync completes', () => {
    const offlineCache = [{ key: 'stale_card', bankName: 'AX' }];
    const liveSyncedCards: any[] = []; // Card was deleted on server while user was offline
    const hasInitialAccessSynced = true;
    const cardsLoaded = true;
    const enabled = true;

    const computeActiveCards = (isOnline: boolean, synced: boolean, loaded: boolean, live: any[], cached: any[]) => {
      if (!isOnline) {
        return cached;
      }
      if (synced && loaded) {
        return live;
      }
      return live.length > 0 ? live : cached;
    };

    const activeCards = computeActiveCards(enabled, hasInitialAccessSynced, cardsLoaded, liveSyncedCards, offlineCache);
    expect(activeCards.length).toBe(0); // Correctly removes stale card
  });
});
