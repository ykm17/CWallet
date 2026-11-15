import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import auth from '@react-native-firebase/auth';
import { getFirestore, doc, onSnapshot } from '@react-native-firebase/firestore';
import { Card, CardGroupAccess, CardUserAccess, Group } from '../types/Types';
import { COLLECTIONS } from '../constants/Firestore';
import { parseCardDocument } from '../services/cardService';
import { listenAccessForGroups, listenAccessForUser } from '../services/sharingService';
import { getAppleUserId } from '../services/userService';
import { sortCardsByLatest, toTimestampMillis } from '../services/sharingUtils';
import EncryptedStorage from 'react-native-encrypted-storage';

export const SHARED_CARDS_STORAGE_KEY = 'shared_cards';

export const useAccessibleCards = (groups: Group[], enabled: boolean) => {
  const [accessRecords, setAccessRecords] = useState<CardGroupAccess[]>([]);
  const [userAccessRecords, setUserAccessRecords] = useState<CardUserAccess[]>([]);
  const [cardsById, setCardsById] = useState<Record<string, Card>>({});
  const [loading, setLoading] = useState(false);
  const [offlineCards, setOfflineCards] = useState<Card[]>([]);
  const cardUnsubsRef = useRef<Array<() => void>>([]);

  const groupIds = useMemo(() => groups.map((group) => group.groupId).sort().join(','), [groups]);
  const groupList = useMemo(() => groups, [groupIds]);

  // Load securely cached shared cards for offline mode
  const loadOfflineCards = useCallback(async () => {
    try {
      const jsonValue = await EncryptedStorage.getItem(SHARED_CARDS_STORAGE_KEY);
      if (jsonValue) {
        const parsed = JSON.parse(jsonValue);
        if (Array.isArray(parsed)) {
          setOfflineCards(parsed);
        }
      }
    } catch (e) {
      console.error('Failed to load offline shared cards:', e);
    }
  }, []);

  useEffect(() => {
    loadOfflineCards();
  }, [loadOfflineCards, enabled]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    setLoading(true);
    const unsubGroups = listenAccessForGroups(
      groupList.map((group) => group.groupId),
      (records) => {
        setAccessRecords(records);
        setLoading(false);
      },
      (error) => {
        console.error('Failed to load shared card access', error);
        setLoading(false);
      },
    );

    const currentUser = auth().currentUser;
    const unsubUser = currentUser?.uid
      ? listenAccessForUser(
          currentUser.uid,
          currentUser.email || '',
          getAppleUserId(currentUser),
          (records) => {
            setUserAccessRecords(records);
          },
          (error) => {
            console.error('Failed to load 1-to-1 card access', error);
          },
        )
      : () => {};

    return () => {
      unsubGroups();
      unsubUser();
    };
  }, [enabled, groupIds]);

  const cardIdsKey = useMemo(() => {
    const fromGroups = accessRecords.map((r) => r.cardId);
    const fromUsers = userAccessRecords.map((r) => r.cardId);
    return Array.from(new Set([...fromGroups, ...fromUsers])).sort().join(',');
  }, [accessRecords, userAccessRecords]);

  useEffect(() => {
    cardUnsubsRef.current.forEach((unsubscribe) => unsubscribe());
    cardUnsubsRef.current = [];
    const cardIds = cardIdsKey ? cardIdsKey.split(',') : [];
    if (!enabled || cardIds.length === 0) {
      setCardsById({});
      return;
    }

    const db = getFirestore();
    cardIds.forEach((cardId) => {
      const unsubscribe = onSnapshot(
        doc(db, COLLECTIONS.CARDS, cardId),
        (snapshot) => {
          setCardsById((prev) => {
            const next = { ...prev };
            if (!snapshot.exists()) {
              delete next[cardId];
              return next;
            }
            const card = parseCardDocument(snapshot);
            if (card) {
              next[cardId] = card;
            } else {
              delete next[cardId];
            }
            return next;
          });
        },
        (error) => {
          console.error('Failed to listen to shared card', cardId, error);
          setCardsById((prev) => {
            const next = { ...prev };
            delete next[cardId];
            return next;
          });
        },
      );
      cardUnsubsRef.current.push(unsubscribe);
    });

    return () => {
      cardUnsubsRef.current.forEach((unsubscribe) => unsubscribe());
      cardUnsubsRef.current = [];
    };
  }, [cardIdsKey, enabled]);

  const cards = useMemo(() => {
    const groupNameById = groupList.reduce<Record<string, string>>((acc, group) => {
      acc[group.groupId] = group.name;
      return acc;
    }, {});
    const groupIdsByCard: Record<string, string[]> = {};
    const userAccessByCard: Record<string, CardUserAccess[]> = {};
    const latestSharedAtByCard: Record<string, number> = {};

    accessRecords.forEach((record) => {
      if (!groupIdsByCard[record.cardId]) {
        groupIdsByCard[record.cardId] = [];
      }
      if (!groupIdsByCard[record.cardId].includes(record.groupId)) {
        groupIdsByCard[record.cardId].push(record.groupId);
      }
      const recordSharedAt = toTimestampMillis(record.sharedAt);
      if (recordSharedAt > (latestSharedAtByCard[record.cardId] || 0)) {
        latestSharedAtByCard[record.cardId] = recordSharedAt;
      }
    });

    userAccessRecords.forEach((record) => {
      if (!userAccessByCard[record.cardId]) {
        userAccessByCard[record.cardId] = [];
      }
      userAccessByCard[record.cardId].push(record);
      const recordSharedAt = toTimestampMillis(record.sharedAt);
      if (recordSharedAt > (latestSharedAtByCard[record.cardId] || 0)) {
        latestSharedAtByCard[record.cardId] = recordSharedAt;
      }
    });

    const mapped = Object.values(cardsById).map((card) => {
      const matchedGroupNames = new Set<string>();
      const matchedUserNames = new Set<string>();
      let sharedByInfo: { name?: string; email?: string } | undefined;

      // 1. From cardGroupAccess records for the user's groups
      (groupIdsByCard[card.key] || []).forEach((gid) => {
        if (groupNameById[gid]) {
          matchedGroupNames.add(groupNameById[gid]);
        }
      });

      // 2. From card.sharedGroupIds on the card matching the user's groups
      (card.sharedGroupIds || []).forEach((gid) => {
        if (groupNameById[gid]) {
          matchedGroupNames.add(groupNameById[gid]);
        }
      });

      // 3. From cardUserAccess records directly shared with current user
      (userAccessByCard[card.key] || []).forEach((uRec) => {
        const name = uRec.sharedByName || uRec.sharedByEmail || 'Direct share';
        matchedUserNames.add(name);
        if (!sharedByInfo) {
          sharedByInfo = {
            name: uRec.sharedByName,
            email: uRec.sharedByEmail,
          };
        }
      });

      const sharedAt = latestSharedAtByCard[card.key] || toTimestampMillis(card.sharedAt) || undefined;

      return {
        ...card,
        sharedAt,
        accessGroupNames: Array.from(matchedGroupNames),
        accessUserNames: Array.from(matchedUserNames),
        sharedByInfo,
      };
    });

    return sortCardsByLatest(mapped);
  }, [cardsById, accessRecords, userAccessRecords, groupList]);

  // Persist live shared cards to EncryptedStorage when online
  useEffect(() => {
    if (enabled && cards.length > 0) {
      EncryptedStorage.setItem(SHARED_CARDS_STORAGE_KEY, JSON.stringify(cards)).catch((e) =>
        console.error('Failed to save shared cards to secure storage:', e),
      );
    }
  }, [enabled, cards]);

  const activeCards = useMemo(() => {
    if (enabled) {
      return cards;
    }
    return cards.length > 0 ? cards : offlineCards;
  }, [enabled, cards, offlineCards]);

  return {
    cards: activeCards,
    accessRecords,
    userAccessRecords,
    loading: enabled ? loading : false,
    refetchOfflineCards: loadOfflineCards,
  };
};
