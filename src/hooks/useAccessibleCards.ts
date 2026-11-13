import { useEffect, useMemo, useRef, useState } from 'react';
import { getFirestore, doc, onSnapshot } from '@react-native-firebase/firestore';
import { Card, CardGroupAccess, Group } from '../types/Types';
import { COLLECTIONS } from '../constants/Firestore';
import { parseCardDocument } from '../services/cardService';
import { listenAccessForGroups } from '../services/sharingService';

export const useAccessibleCards = (groups: Group[], enabled: boolean) => {
  const [accessRecords, setAccessRecords] = useState<CardGroupAccess[]>([]);
  const [cardsById, setCardsById] = useState<Record<string, Card>>({});
  const [loading, setLoading] = useState(false);
  const cardUnsubsRef = useRef<Array<() => void>>([]);

  const groupIds = useMemo(() => groups.map((group) => group.groupId).sort().join(','), [groups]);
  const groupList = useMemo(() => groups, [groupIds]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    setLoading(true);
    const unsubscribe = listenAccessForGroups(
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
    return unsubscribe;
  }, [enabled, groupIds]);

  const cardIdsKey = useMemo(
    () => Array.from(new Set(accessRecords.map((record) => record.cardId))).sort().join(','),
    [accessRecords],
  );

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
    accessRecords.forEach((record) => {
      if (!groupIdsByCard[record.cardId]) {
        groupIdsByCard[record.cardId] = [];
      }
      if (!groupIdsByCard[record.cardId].includes(record.groupId)) {
        groupIdsByCard[record.cardId].push(record.groupId);
      }
    });
    return Object.values(cardsById).map((card) => {
      const matchedGroupNames = new Set<string>();

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

      return {
        ...card,
        accessGroupNames: Array.from(matchedGroupNames),
      };
    });
  }, [cardsById, accessRecords, groupList]);

  return { cards, accessRecords, loading };
};
