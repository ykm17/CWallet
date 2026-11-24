import React, { useContext, useEffect, useMemo, useState, useRef } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, SafeAreaView, Platform } from 'react-native';
import { Alert } from '../components/CustomAlert';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, Icon, Text } from 'react-native-paper';
import auth from '@react-native-firebase/auth';
import { getFirestore, collection, onSnapshot, query, where } from '@react-native-firebase/firestore';
import { RootStackParamList } from '../App';
import { Card, Group, SharedPerson } from '../types/Types';
import { useUserGroups } from '../hooks/useUserGroups';
import { parseCardDocument } from '../services/cardService';
import { unshareCardsFromGroups, unshareCardsFromPeople } from '../services/sharingService';
import { sortCardsByLatest } from '../services/sharingUtils';
import { BANK_COLORS, BANK_DICTIONARY } from '../constants/Constants';
import { COLLECTIONS as FIRESTORE_COLLECTIONS } from '../constants/Firestore';
import { ConnectivityContext } from '../util/Connectivity';

type Props = NativeStackScreenProps<RootStackParamList, 'UnshareFromGroup'>;

interface PersonAccessItem {
  key: string;
  identifier: string;
  displayName: string;
  email?: string;
  appleUserId?: string | null;
  status?: string;
  cardCount: number;
  totalCards: number;
}

const UnshareFromGroup: React.FC<Props> = ({ navigation, route }) => {
  const uid = auth().currentUser?.uid || '';
  const initialCardIds = route.params?.cardIds || [];
  const lockedGroupId = route.params?.groupId;
  const { isConnected } = useContext(ConnectivityContext);
  const { groups } = useUserGroups();
  const [mode, setMode] = useState<'groups' | 'person'>('groups');
  const [ownedCards, setOwnedCards] = useState<Card[]>([]);
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>(initialCardIds);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>(
    lockedGroupId ? [lockedGroupId] : [],
  );
  const [selectedPersonKeys, setSelectedPersonKeys] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (saving || savingRef.current) {
        e.preventDefault();
      }
    });
    return unsubscribe;
  }, [navigation, saving]);

  useEffect(() => {
    navigation.setOptions({
      title: 'Unshare cards',
      headerTitleAlign: 'center',
      headerStyle: { backgroundColor: '#F4F5F7' },
    });
  }, [navigation]);

  useEffect(() => {
    if (!uid) {
      return;
    }
    const db = getFirestore();
    const cardsQuery = query(collection(db, FIRESTORE_COLLECTIONS.CARDS), where('ownerId', '==', uid));
    return onSnapshot(cardsQuery, (snapshot) => {
      const cards: Card[] = [];
      snapshot.forEach((cardDoc: any) => {
        const card = parseCardDocument(cardDoc);
        if (card) {
          cards.push(card);
        }
      });
      setOwnedCards(sortCardsByLatest(cards));
    });
  }, [uid]);

  const initialModeSetRef = useRef(false);
  useEffect(() => {
    if (initialModeSetRef.current || ownedCards.length === 0 || initialCardIds.length === 0) return;
    initialModeSetRef.current = true;
    if (lockedGroupId) return;
    const targetCard = ownedCards.find((c) => initialCardIds.includes(c.key));
    if (targetCard) {
      const hasGroupShares = (targetCard.sharedGroupIds || []).filter(Boolean).length > 0;
      const hasPersonShares = (targetCard.sharedWithUsers || []).length > 0 || (targetCard.sharedEmails || []).length > 0 || (targetCard.sharedUserIds || []).length > 0;
      if (!hasGroupShares && hasPersonShares) {
        setMode('person');
      }
    }
  }, [ownedCards, initialCardIds, lockedGroupId]);

  const groupNameById = useMemo(
    () => groups.reduce<Record<string, string>>((acc, g) => { acc[g.groupId] = g.name; return acc; }, {}),
    [groups],
  );

  const availableGroups = useMemo(
    () => (lockedGroupId ? groups.filter((g) => g.groupId === lockedGroupId) : groups),
    [groups, lockedGroupId],
  );

  const selectedGroups = useMemo(
    () => availableGroups.filter((g) => selectedGroupIds.includes(g.groupId)),
    [availableGroups, selectedGroupIds],
  );

  const selectedGroup = selectedGroups[0];

  // List of { cardId, groupId } pairs that will be unshared
  const unsharePairs = useMemo(() => {
    if (selectedGroupIds.length === 0 || selectedCardIds.length === 0) return [];
    const pairs: Array<{ cardId: string; groupId: string }> = [];
    for (const cardId of selectedCardIds) {
      const card = ownedCards.find((c) => c.key === cardId);
      const cardSharedGroupIds = card?.sharedGroupIds || [];
      for (const groupId of selectedGroupIds) {
        if (cardSharedGroupIds.includes(groupId)) {
          pairs.push({ cardId, groupId });
        }
      }
    }
    return pairs;
  }, [selectedCardIds, selectedGroupIds, ownedCards]);

  // Aggregate people who have access to any owned cards
  const peopleWithAccess = useMemo(() => {
    const map = new Map<string, PersonAccessItem>();
    ownedCards.forEach((card) => {
      const isCardSelected = selectedCardIds.includes(card.key);
      const seenOnCard = new Set<string>();

      (card.sharedWithUsers || []).forEach((p) => {
        const key = (p.email?.toLowerCase() || p.appleUserId || p.recipientUid || '').trim();
        if (!key) return;
        seenOnCard.add(key);
        const existing = map.get(key);
        if (existing) {
          existing.totalCards += 1;
          if (isCardSelected) {
            existing.cardCount += 1;
          }
        } else {
          map.set(key, {
            key,
            identifier: p.email || p.appleUserId || p.recipientUid || '',
            displayName: p.displayName || p.email || p.appleUserId || 'Unknown person',
            email: p.email,
            appleUserId: p.appleUserId,
            status: p.status,
            cardCount: isCardSelected ? 1 : 0,
            totalCards: 1,
          });
        }
      });

      (card.sharedEmails || []).forEach((email) => {
        const key = email.toLowerCase().trim();
        if (!key || seenOnCard.has(key)) return;
        seenOnCard.add(key);
        const existing = map.get(key);
        if (existing) {
          existing.totalCards += 1;
          if (isCardSelected) {
            existing.cardCount += 1;
          }
        } else {
          map.set(key, {
            key,
            identifier: email,
            displayName: email,
            email,
            cardCount: isCardSelected ? 1 : 0,
            totalCards: 1,
          });
        }
      });
    });
    return Array.from(map.values());
  }, [ownedCards, selectedCardIds]);

  // List of { cardId, personKey } pairs that will be unshared
  const personUnsharePairs = useMemo(() => {
    if (selectedPersonKeys.length === 0 || selectedCardIds.length === 0) return [];
    const pairs: Array<{ cardId: string; personKey: string }> = [];
    for (const cardId of selectedCardIds) {
      const card = ownedCards.find((c) => c.key === cardId);
      const sharedUsers = card?.sharedWithUsers || [];
      const sharedEmails = (card?.sharedEmails || []).map((e) => e.toLowerCase().trim());
      const sharedUserIds = card?.sharedUserIds || [];
      for (const key of selectedPersonKeys) {
        const normKey = key.toLowerCase().trim();
        const hasAccess =
          sharedUsers.some(
            (u) =>
              u.recipientUid === key ||
              u.email?.toLowerCase().trim() === normKey ||
              u.appleUserId === key,
          ) ||
          sharedEmails.includes(normKey) ||
          sharedUserIds.includes(key);
        if (hasAccess) {
          pairs.push({ cardId, personKey: key });
        }
      }
    }
    return pairs;
  }, [selectedCardIds, selectedPersonKeys, ownedCards]);

  const toggleCard = (cardId: string) => {
    setSelectedCardIds((prev) => (
      prev.includes(cardId) ? prev.filter((id) => id !== cardId) : [...prev, cardId]
    ));
  };

  const handleToggleSelectAllCards = () => {
    if (selectedCardIds.length === ownedCards.length) {
      setSelectedCardIds([]);
    } else {
      setSelectedCardIds(ownedCards.map((c) => c.key));
    }
  };

  const toggleGroup = (groupId: string) => {
    if (lockedGroupId) return;
    setSelectedGroupIds((prev) => (
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]
    ));
  };

  const handleToggleSelectAllGroups = () => {
    if (lockedGroupId) return;
    if (selectedGroupIds.length === availableGroups.length) {
      setSelectedGroupIds([]);
    } else {
      setSelectedGroupIds(availableGroups.map((g) => g.groupId));
    }
  };

  const togglePerson = (personKey: string) => {
    setSelectedPersonKeys((prev) => (
      prev.includes(personKey) ? prev.filter((k) => k !== personKey) : [...prev, personKey]
    ));
  };

  const handleToggleSelectAllPeople = () => {
    if (selectedPersonKeys.length === peopleWithAccess.length) {
      setSelectedPersonKeys([]);
    } else {
      setSelectedPersonKeys(peopleWithAccess.map((p) => p.key));
    }
  };

  const handleUnshareGroups = async () => {
    if (saving || savingRef.current) return;
    if (!isConnected) {
      Alert.alert('Offline', 'You must be online to unshare cards from groups.');
      return;
    }
    if (selectedGroupIds.length === 0) {
      Alert.alert('Select groups', 'Please select at least one group to unshare from.');
      return;
    }
    if (selectedCardIds.length === 0) {
      Alert.alert('Select cards', 'Choose at least one card to unshare.');
      return;
    }
    if (unsharePairs.length === 0) {
      Alert.alert(
        'Not in selected groups',
        'None of the selected cards are currently shared with the selected group(s).',
      );
      return;
    }

    const groupNamesText = selectedGroups.length <= 2
      ? selectedGroups.map((g) => g.name).join(' & ')
      : `${selectedGroups.length} groups (${selectedGroups.map((g) => g.name).join(', ')})`;

    const cardIdsToUnshare = Array.from(new Set(unsharePairs.map((p) => p.cardId)));
    const confirmMessage = `Unshare ${cardIdsToUnshare.length} card${cardIdsToUnshare.length === 1 ? '' : 's'} from ${groupNamesText}? (${unsharePairs.length} group mapping${unsharePairs.length === 1 ? '' : 's'}). Group members will no longer be able to view them.`;

    Alert.alert(
      'Confirm Unshare',
      confirmMessage,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unshare',
          style: 'destructive',
          onPress: async () => {
            if (savingRef.current) return;
            try {
              savingRef.current = true;
              setSaving(true);
              await unshareCardsFromGroups(cardIdsToUnshare, selectedGroupIds);
              Alert.alert(
                'Cards unshared',
                `${cardIdsToUnshare.length} card${cardIdsToUnshare.length === 1 ? '' : 's'} unshared across ${selectedGroups.length} group${selectedGroups.length === 1 ? '' : 's'}.`,
                [{ text: 'OK', onPress: () => navigation.goBack() }],
              );
            } catch (error: any) {
              Alert.alert('Could not unshare cards', error.message || 'Please try again.');
            } finally {
              savingRef.current = false;
              setSaving(false);
            }
          },
        },
      ],
    );
  };

  const handleUnshareFromPeople = async () => {
    if (saving || savingRef.current) return;
    if (!isConnected) {
      Alert.alert('Offline', 'You must be online to unshare cards from people.');
      return;
    }
    if (selectedPersonKeys.length === 0) {
      Alert.alert('Select person', 'Please select at least one person to unshare from.');
      return;
    }
    if (selectedCardIds.length === 0) {
      Alert.alert('Select cards', 'Choose at least one card to unshare.');
      return;
    }
    if (personUnsharePairs.length === 0) {
      Alert.alert(
        'Not shared with selected people',
        'None of the selected cards are currently shared with the selected person(s).',
      );
      return;
    }

    const selectedPeopleObjects = peopleWithAccess.filter((p) => selectedPersonKeys.includes(p.key));
    const peopleNamesText = selectedPeopleObjects.length <= 2
      ? selectedPeopleObjects.map((p) => p.displayName).join(' & ')
      : `${selectedPeopleObjects.length} people (${selectedPeopleObjects.map((p) => p.displayName).join(', ')})`;

    const cardIdsToUnshare = Array.from(new Set(personUnsharePairs.map((p) => p.cardId)));
    const confirmMessage = `Unshare ${cardIdsToUnshare.length} card${cardIdsToUnshare.length === 1 ? '' : 's'} from ${peopleNamesText}? They will immediately lose access.`;

    Alert.alert(
      'Confirm Unshare',
      confirmMessage,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unshare',
          style: 'destructive',
          onPress: async () => {
            if (savingRef.current) return;
            try {
              savingRef.current = true;
              setSaving(true);
              await unshareCardsFromPeople(cardIdsToUnshare, selectedPersonKeys);
              Alert.alert(
                'Cards unshared',
                `Successfully unshared ${cardIdsToUnshare.length} card${cardIdsToUnshare.length === 1 ? '' : 's'} from ${selectedPeopleObjects.length} person${selectedPeopleObjects.length === 1 ? '' : 's'}.`,
                [{ text: 'OK', onPress: () => navigation.goBack() }],
              );
            } catch (error: any) {
              Alert.alert('Could not unshare cards', error.message || 'Please try again.');
            } finally {
              savingRef.current = false;
              setSaving(false);
            }
          },
        },
      ],
    );
  };

  const renderCard = ({ item }: { item: Card }) => {
    const selected = selectedCardIds.includes(item.key);
    const cardSharedGroupIds = item.sharedGroupIds || [];
    const sharedGroupNames = cardSharedGroupIds
      .map((gid) => groupNameById[gid])
      .filter(Boolean);
    const sharedPeopleNames = (item.sharedWithUsers || [])
      .map((u) => u.displayName || u.email || u.appleUserId)
      .filter(Boolean);
    const allSharedNames = [...sharedGroupNames, ...sharedPeopleNames];
    const isShared = allSharedNames.length > 0;

    return (
      <TouchableOpacity
        style={[
          styles.row,
          selected && styles.rowSelected,
        ]}
        onPress={() => toggleCard(item.key)}
        activeOpacity={0.7}
      >
        <Icon
          source={selected ? 'checkbox-marked' : 'checkbox-blank-outline'}
          size={22}
          color={selected ? '#111111' : '#9CA3AF'}
        />
        <View style={[styles.bankIndicator, { backgroundColor: BANK_COLORS[item.bankName] || '#1B1B1B' }]} />
        <View style={{ flex: 1 }}>
          <View style={styles.cardTitleRow}>
            <Text
              style={styles.rowTitle}
              numberOfLines={1}
            >
              {item.name || item.ownerName}
            </Text>
            {!isShared && (
              <View style={styles.notInGroupBadge}>
                <Text style={styles.notInGroupText}>Not shared</Text>
              </View>
            )}
          </View>
          <Text style={styles.rowSubtitle} numberOfLines={2}>
            {BANK_DICTIONARY[item.bankName] || item.bankName} · {item.number.slice(-4)}
            {allSharedNames.length > 0
              ? ` · Shared with ${allSharedNames.join(', ')}`
              : ' · Not shared'}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderGroup = ({ item }: { item: Group }) => {
    const selected = selectedGroupIds.includes(item.groupId);
    return (
      <TouchableOpacity
        style={[styles.row, selected && styles.rowSelected]}
        onPress={() => toggleGroup(item.groupId)}
        activeOpacity={0.7}
      >
        <Icon
          source={selected ? 'checkbox-marked' : 'checkbox-blank-outline'}
          size={22}
          color={selected ? '#111111' : '#9CA3AF'}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle} numberOfLines={1}>{item.name}</Text>
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {item.memberCount} members · {item.ownerId === uid ? 'Your group' : 'Joined group'}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderPerson = ({ item }: { item: PersonAccessItem }) => {
    const selected = selectedPersonKeys.includes(item.key);
    const hasAccessToSelected = item.cardCount > 0;
    return (
      <TouchableOpacity
        style={[styles.row, selected && styles.rowSelected, !hasAccessToSelected && styles.rowDimmed]}
        onPress={() => togglePerson(item.key)}
        activeOpacity={0.7}
      >
        <Icon
          source={selected ? 'checkbox-marked' : 'checkbox-blank-outline'}
          size={22}
          color={selected ? '#111111' : '#9CA3AF'}
        />
        <View style={styles.personIconWrapper}>
          <Icon
            source={item.email ? 'email-outline' : 'apple'}
            size={18}
            color="#374151"
          />
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.personTitleRow}>
            <Text style={styles.rowTitle} numberOfLines={1}>{item.displayName}</Text>
            {item.status === 'pending' && (
              <View style={styles.pendingBadge}>
                <Text style={styles.pendingText}>Pending</Text>
              </View>
            )}
          </View>
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {item.identifier}
            {selectedCardIds.length > 0
              ? ` · ${item.cardCount} selected card${item.cardCount === 1 ? '' : 's'}`
              : ` · ${item.totalCards} card${item.totalCards === 1 ? '' : 's'}`}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {!isConnected && (
          <View style={styles.offlineBanner}>
            <Icon source="cloud-off-outline" size={16} color="#B91C1C" />
            <Text style={styles.offlineBannerText}>You are offline. Unsharing cards is disabled.</Text>
          </View>
        )}

        {/* Segmented Control (hidden if opened with locked group) */}
        {!lockedGroupId && (
          <View style={styles.segmentedControl}>
            <TouchableOpacity
              style={[styles.segmentBtn, mode === 'groups' && styles.segmentBtnActive]}
              onPress={() => setMode('groups')}
              activeOpacity={0.8}
            >
              <Icon
                source="account-group"
                size={18}
                color={mode === 'groups' ? '#FFFFFF' : '#6B7280'}
              />
              <Text style={[styles.segmentText, mode === 'groups' && styles.segmentTextActive]}>
                Groups
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.segmentBtn, mode === 'person' && styles.segmentBtnActive]}
              onPress={() => setMode('person')}
              activeOpacity={0.8}
            >
              <Icon
                source="account-remove-outline"
                size={18}
                color={mode === 'person' ? '#FFFFFF' : '#6B7280'}
              />
              <Text style={[styles.segmentText, mode === 'person' && styles.segmentTextActive]}>
                Person
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {lockedGroupId && selectedGroup ? (
          <>
            <View style={styles.destinationBanner}>
              <Icon source="account-group" size={24} color="#111111" />
              <View style={{ flex: 1, marginHorizontal: 8 }}>
                <Text style={styles.destinationLabel}>Unsharing from group</Text>
                <Text style={styles.destinationName} numberOfLines={1}>
                  {selectedGroup.name}
                </Text>
              </View>
              <View style={styles.destinationBadge}>
                <Text style={styles.destinationBadgeText}>{selectedGroup.memberCount} members</Text>
              </View>
            </View>

            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>
                Select cards ({selectedCardIds.length} selected)
              </Text>
              {ownedCards.length > 0 && (
                <TouchableOpacity onPress={handleToggleSelectAllCards} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={styles.selectAllText}>
                    {selectedCardIds.length === ownedCards.length ? 'Deselect all' : 'Select all'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
            <FlatList
              data={ownedCards}
              keyExtractor={(item) => item.key}
              renderItem={renderCard}
              style={styles.cardListFull}
              contentContainerStyle={ownedCards.length === 0 ? styles.emptyContainer : { paddingBottom: 8 }}
              ListEmptyComponent={
                <View style={styles.emptyCardBox}>
                  <Icon source="credit-card-check-outline" size={36} color="#9CA3AF" />
                  <Text style={styles.emptyTitle}>No cards in your wallet</Text>
                  <Text style={styles.emptyText}>You do not have any cards to unshare.</Text>
                </View>
              }
            />
          </>
        ) : mode === 'groups' ? (
          <View style={styles.splitHalfContainer}>
            <View style={styles.halfSection}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>
                  Select cards ({selectedCardIds.length} selected)
                </Text>
                {ownedCards.length > 0 && (
                  <TouchableOpacity onPress={handleToggleSelectAllCards} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={styles.selectAllText}>
                      {selectedCardIds.length === ownedCards.length ? 'Deselect all' : 'Select all'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
              <FlatList
                data={ownedCards}
                keyExtractor={(item) => item.key}
                renderItem={renderCard}
                style={styles.halfList}
                contentContainerStyle={ownedCards.length === 0 ? styles.emptyContainer : { paddingBottom: 6 }}
                ListEmptyComponent={
                  <View style={styles.emptyCardBox}>
                    <Icon source="credit-card-check-outline" size={32} color="#9CA3AF" />
                    <Text style={styles.emptyTitle}>No cards in your wallet</Text>
                    <Text style={styles.emptyText}>You do not have any cards to unshare.</Text>
                  </View>
                }
              />
            </View>

            <View style={styles.halfSection}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>
                  Select groups ({selectedGroupIds.length} selected)
                </Text>
                {availableGroups.length > 0 && !lockedGroupId && (
                  <TouchableOpacity onPress={handleToggleSelectAllGroups} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={styles.selectAllText}>
                      {selectedGroupIds.length === availableGroups.length ? 'Deselect all' : 'Select all'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
              <FlatList
                data={availableGroups}
                keyExtractor={(item) => item.groupId}
                renderItem={renderGroup}
                style={styles.halfList}
                contentContainerStyle={availableGroups.length === 0 ? styles.emptyContainer : { paddingBottom: 6 }}
                ListEmptyComponent={<Text style={styles.emptyText}>No groups available.</Text>}
              />
            </View>
          </View>
        ) : (
          /* Person Mode */
          <View style={styles.splitHalfContainer}>
            <View style={styles.halfSection}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>
                  Select cards ({selectedCardIds.length} selected)
                </Text>
                {ownedCards.length > 0 && (
                  <TouchableOpacity onPress={handleToggleSelectAllCards} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={styles.selectAllText}>
                      {selectedCardIds.length === ownedCards.length ? 'Deselect all' : 'Select all'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
              <FlatList
                data={ownedCards}
                keyExtractor={(item) => item.key}
                renderItem={renderCard}
                style={styles.halfList}
                contentContainerStyle={ownedCards.length === 0 ? styles.emptyContainer : { paddingBottom: 6 }}
                ListEmptyComponent={
                  <View style={styles.emptyCardBox}>
                    <Icon source="credit-card-check-outline" size={32} color="#9CA3AF" />
                    <Text style={styles.emptyTitle}>No cards in your wallet</Text>
                    <Text style={styles.emptyText}>You do not have any cards to unshare.</Text>
                  </View>
                }
              />
            </View>

            <View style={styles.halfSection}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>
                  Select people ({selectedPersonKeys.length} selected)
                </Text>
                {peopleWithAccess.length > 0 && (
                  <TouchableOpacity onPress={handleToggleSelectAllPeople} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={styles.selectAllText}>
                      {selectedPersonKeys.length === peopleWithAccess.length ? 'Deselect all' : 'Select all'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
              <FlatList
                data={peopleWithAccess}
                keyExtractor={(item) => item.key}
                renderItem={renderPerson}
                style={styles.halfList}
                contentContainerStyle={peopleWithAccess.length === 0 ? styles.emptyContainer : { paddingBottom: 6 }}
                ListEmptyComponent={
                  <View style={styles.emptyCardBox}>
                    <Icon source="account-check-outline" size={32} color="#9CA3AF" />
                    <Text style={styles.emptyTitle}>No individual shares</Text>
                    <Text style={styles.emptyText}>You haven't shared cards directly with anyone yet.</Text>
                  </View>
                }
              />
            </View>
          </View>
        )}
      </View>

      <View style={styles.bottomFooter}>
        {mode === 'groups' ? (
          <>
            {selectedGroupIds.length > 0 && selectedCardIds.length > 0 && (
              <View style={styles.confirmBox}>
                <Text style={[styles.confirmText, unsharePairs.length === 0 && { color: '#6B7280' }]} numberOfLines={2}>
                  {unsharePairs.length > 0
                    ? `Unsharing ${selectedCardIds.length} card${selectedCardIds.length === 1 ? '' : 's'} across ${selectedGroupIds.length} group${selectedGroupIds.length === 1 ? '' : 's'} (${unsharePairs.length} mapping${unsharePairs.length === 1 ? '' : 's'})`
                    : `None of the selected cards are shared with the selected group${selectedGroupIds.length === 1 ? '' : 's'}`}
                </Text>
              </View>
            )}

            <Button
              mode="contained"
              onPress={handleUnshareGroups}
              loading={saving}
              disabled={saving || !isConnected || selectedGroupIds.length === 0 || selectedCardIds.length === 0 || unsharePairs.length === 0}
              style={[
                styles.unshareButton,
                (!isConnected || selectedGroupIds.length === 0 || selectedCardIds.length === 0 || unsharePairs.length === 0) && { opacity: 0.55 },
              ]}
              labelStyle={{ color: '#FFFFFF', fontWeight: '700' }}
            >
              {!isConnected
                ? 'Offline (Cannot unshare)'
                : selectedGroupIds.length === 0
                ? 'Select groups'
                : selectedCardIds.length === 0
                ? 'Select cards'
                : unsharePairs.length === 0
                ? 'Not in selected groups'
                : `Unshare (${unsharePairs.length})`}
            </Button>
          </>
        ) : (
          /* Person Mode Footer */
          <>
            {selectedPersonKeys.length > 0 && selectedCardIds.length > 0 && (
              <View style={styles.confirmBox}>
                <Text style={[styles.confirmText, personUnsharePairs.length === 0 && { color: '#6B7280' }]} numberOfLines={2}>
                  {personUnsharePairs.length > 0
                    ? `Unsharing ${selectedCardIds.length} card${selectedCardIds.length === 1 ? '' : 's'} from ${selectedPersonKeys.length} person${selectedPersonKeys.length === 1 ? '' : 's'} (${personUnsharePairs.length} mapping${personUnsharePairs.length === 1 ? '' : 's'})`
                    : 'None of the selected cards are shared with the selected person(s)'}
                </Text>
              </View>
            )}

            <Button
              mode="contained"
              onPress={handleUnshareFromPeople}
              loading={saving}
              disabled={
                saving ||
                !isConnected ||
                selectedPersonKeys.length === 0 ||
                selectedCardIds.length === 0 ||
                personUnsharePairs.length === 0
              }
              style={[
                styles.unshareButton,
                (!isConnected ||
                  selectedPersonKeys.length === 0 ||
                  selectedCardIds.length === 0 ||
                  personUnsharePairs.length === 0) && { opacity: 0.55 },
              ]}
              labelStyle={{ color: '#FFFFFF', fontWeight: '700' }}
            >
              {!isConnected
                ? 'Offline (Cannot unshare)'
                : selectedPersonKeys.length === 0
                ? 'Select people'
                : selectedCardIds.length === 0
                ? 'Select cards'
                : personUnsharePairs.length === 0
                ? 'Not shared with selected people'
                : `Unshare (${personUnsharePairs.length})`}
            </Button>
          </>
        )}
      </View>
    </SafeAreaView>
  );
};

export default UnshareFromGroup;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F4F5F7',
  },
  content: {
    flex: 1,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: '#E5E7EB',
    borderRadius: 10,
    padding: 3,
    marginBottom: 10,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 8,
  },
  segmentBtnActive: {
    backgroundColor: '#111111',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
  },
  segmentTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderWidth: 1,
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  offlineBannerText: {
    fontSize: 12,
    color: '#B91C1C',
    fontWeight: '600',
    flex: 1,
  },
  destinationBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  destinationLabel: {
    fontSize: 11,
    color: '#6B7280',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  destinationName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111111',
    marginTop: 1,
  },
  destinationBadge: {
    backgroundColor: '#F3F4F6',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  destinationBadgeText: {
    fontSize: 11,
    color: '#4B5563',
    fontWeight: '600',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    marginTop: 4,
  },
  sectionTitle: {
    fontWeight: '700',
    fontSize: 14,
    color: '#111111',
  },
  selectAllText: {
    color: '#111111',
    fontWeight: '700',
    fontSize: 12,
  },
  bankIndicator: {
    width: 6,
    height: 36,
    borderRadius: 3,
  },
  splitHalfContainer: {
    flex: 1,
    gap: 12,
  },
  halfSection: {
    flex: 1,
  },
  halfList: {
    flex: 1,
  },
  cardListFull: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  rowSelected: {
    borderWidth: 1,
    borderColor: '#111111',
  },
  rowDisabled: {
    opacity: 0.55,
  },
  rowDimmed: {
    opacity: 0.65,
  },
  personIconWrapper: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  personTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pendingBadge: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  pendingText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#1D4ED8',
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  rowTitle: {
    fontWeight: '700',
    color: '#111111',
    flex: 1,
  },
  rowTitleDisabled: {
    color: '#6B7280',
  },
  notInGroupBadge: {
    backgroundColor: '#F3F4F6',
    borderColor: '#D1D5DB',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    flexShrink: 0,
  },
  notInGroupText: {
    color: '#6B7280',
    fontSize: 10,
    fontWeight: '700',
  },
  rowSubtitle: {
    color: '#6B7280',
    fontSize: 12,
    marginTop: 2,
  },
  emptyContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyCardBox: {
    alignItems: 'center',
    paddingVertical: 28,
    paddingHorizontal: 20,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#4B5563',
    marginTop: 8,
  },
  emptyText: {
    color: '#6B7280',
    fontSize: 12,
    marginTop: 4,
    textAlign: 'center',
  },
  bottomFooter: {
    backgroundColor: '#F4F5F7',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 12 : 12,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  confirmBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  confirmText: {
    fontWeight: '600',
    color: '#111111',
    fontSize: 13,
  },
  unshareButton: {
    backgroundColor: '#111111',
    borderRadius: 8,
  },
});
