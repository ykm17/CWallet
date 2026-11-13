import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, Alert, SafeAreaView, Platform } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, Icon, Text } from 'react-native-paper';
import auth from '@react-native-firebase/auth';
import { getFirestore, collection, onSnapshot, query, where } from '@react-native-firebase/firestore';
import { RootStackParamList } from '../App';
import { Card, Group } from '../types/Types';
import { useUserGroups } from '../hooks/useUserGroups';
import { parseCardDocument } from '../services/cardService';
import { unshareCardsFromGroup, unshareCardsFromAllGroups } from '../services/sharingService';
import { BANK_COLORS, BANK_DICTIONARY } from '../constants/Constants';
import { COLLECTIONS as FIRESTORE_COLLECTIONS } from '../constants/Firestore';

type Props = NativeStackScreenProps<RootStackParamList, 'UnshareFromGroup'>;

interface GroupOption {
  groupId: string;
  name: string;
  subtitle: string;
  isAll?: boolean;
}

const UnshareFromGroup: React.FC<Props> = ({ navigation, route }) => {
  const uid = auth().currentUser?.uid || '';
  const initialCardIds = route.params?.cardIds || [];
  const lockedGroupId = route.params?.groupId;
  const { groups } = useUserGroups();
  const [ownedCards, setOwnedCards] = useState<Card[]>([]);
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>(initialCardIds);
  const [selectedGroupId, setSelectedGroupId] = useState<string>(lockedGroupId || '__ALL__');
  const [saving, setSaving] = useState(false);

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
      setOwnedCards(cards);
    });
  }, [uid]);

  const groupNameById = useMemo(
    () => groups.reduce<Record<string, string>>((acc, g) => { acc[g.groupId] = g.name; return acc; }, {}),
    [groups],
  );

  const lockedGroup = useMemo(
    () => groups.find((g) => g.groupId === lockedGroupId),
    [groups, lockedGroupId],
  );

  const groupOptions = useMemo<GroupOption[]>(() => {
    if (lockedGroupId) {
      return [
        {
          groupId: lockedGroupId,
          name: lockedGroup?.name || 'Selected group',
          subtitle: lockedGroup ? `${lockedGroup.memberCount} members · Selected group` : 'Selected group',
        },
      ];
    }

    const options: GroupOption[] = [
      {
        groupId: '__ALL__',
        name: 'All groups',
        subtitle: 'Remove card access from all groups at once',
        isAll: true,
      },
    ];

    groups.forEach((g) => {
      options.push({
        groupId: g.groupId,
        name: g.name,
        subtitle: `${g.memberCount} members · ${g.ownerId === uid ? 'Your group' : 'Joined group'}`,
      });
    });

    return options;
  }, [lockedGroupId, lockedGroup, groups, uid]);

  const targetGroupName = useMemo(() => {
    if (selectedGroupId === '__ALL__') return 'all groups';
    const group = groups.find((g) => g.groupId === selectedGroupId);
    return group?.name || 'selected group';
  }, [selectedGroupId, groups]);

  const isCardEligible = (card: Card) => {
    const sharedIds = card.sharedGroupIds || [];
    if (sharedIds.length === 0) return false;
    if (selectedGroupId === '__ALL__') return true;
    return sharedIds.includes(selectedGroupId);
  };

  const eligibleCards = useMemo(
    () => ownedCards.filter((card) => isCardEligible(card)),
    [ownedCards, selectedGroupId],
  );

  const eligibleSelectedCards = useMemo(() => {
    return ownedCards.filter((card) => selectedCardIds.includes(card.key) && isCardEligible(card));
  }, [ownedCards, selectedCardIds, selectedGroupId]);

  const ineligibleSelectedCount = selectedCardIds.length - eligibleSelectedCards.length;

  const toggleCard = (cardId: string) => {
    setSelectedCardIds((prev) => (
      prev.includes(cardId) ? prev.filter((id) => id !== cardId) : [...prev, cardId]
    ));
  };

  const handleToggleSelectAll = () => {
    if (eligibleSelectedCards.length === eligibleCards.length) {
      setSelectedCardIds([]);
    } else {
      setSelectedCardIds(eligibleCards.map((c) => c.key));
    }
  };

  const handleUnshare = async () => {
    if (!selectedGroupId) {
      Alert.alert('Select a group', 'Please select a group or "All groups" to unshare from.');
      return;
    }
    if (eligibleSelectedCards.length === 0) {
      Alert.alert(
        'No cards to unshare',
        `Select at least one card that is shared with ${targetGroupName}.`,
      );
      return;
    }

    const cardCount = eligibleSelectedCards.length;
    const confirmMessage =
      selectedGroupId === '__ALL__'
        ? `Unshare ${cardCount} card${cardCount === 1 ? '' : 's'} from all groups? Group members will no longer be able to view them. Card ownership will remain with you.`
        : `Unshare ${cardCount} card${cardCount === 1 ? '' : 's'} from ${targetGroupName}? Group members will no longer be able to view them. Card ownership will remain with you.`;

    Alert.alert(
      'Confirm Unshare',
      confirmMessage,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unshare',
          style: 'destructive',
          onPress: async () => {
            try {
              setSaving(true);
              const cardIdsToUnshare = eligibleSelectedCards.map((c) => c.key);
              if (selectedGroupId === '__ALL__') {
                const count = await unshareCardsFromAllGroups(cardIdsToUnshare);
                Alert.alert(
                  'Cards unshared',
                  `${count} card${count === 1 ? '' : 's'} unshared from all groups.`,
                  [{ text: 'OK', onPress: () => navigation.goBack() }],
                );
              } else {
                const count = await unshareCardsFromGroup(cardIdsToUnshare, selectedGroupId);
                Alert.alert(
                  'Cards unshared',
                  `${count} card${count === 1 ? '' : 's'} unshared from ${targetGroupName}.`,
                  [{ text: 'OK', onPress: () => navigation.goBack() }],
                );
              }
            } catch (error: any) {
              Alert.alert('Could not unshare cards', error.message || 'Please try again.');
            } finally {
              setSaving(false);
            }
          },
        },
      ],
    );
  };

  const renderCard = ({ item }: { item: Card }) => {
    const eligible = isCardEligible(item);
    const selected = selectedCardIds.includes(item.key) && eligible;
    const sharedGroupNames = (item.sharedGroupIds || [])
      .map((gid) => groupNameById[gid])
      .filter(Boolean);
    const isSharedAnywhere = (item.sharedGroupIds || []).length > 0;

    return (
      <TouchableOpacity
        style={[
          styles.row,
          selected && styles.rowSelected,
          !eligible && styles.rowDisabled,
        ]}
        onPress={() => {
          if (!eligible) {
            Alert.alert(
              'Card Not in Group',
              !isSharedAnywhere
                ? `"${item.name || item.ownerName}" is not shared with any group.`
                : `"${item.name || item.ownerName}" is not shared with ${targetGroupName}.`,
            );
            return;
          }
          toggleCard(item.key);
        }}
        activeOpacity={eligible ? 0.7 : 0.9}
      >
        <Icon
          source={
            !eligible
              ? 'minus-circle-outline'
              : selected
              ? 'checkbox-marked'
              : 'checkbox-blank-outline'
          }
          size={22}
          color={!eligible ? '#D1D5DB' : selected ? '#111111' : '#9CA3AF'}
        />
        <View style={[styles.bankIndicator, { backgroundColor: BANK_COLORS[item.bankName] || '#1B1B1B' }]} />
        <View style={{ flex: 1 }}>
          <View style={styles.cardTitleRow}>
            <Text
              style={[styles.rowTitle, !eligible && styles.rowTitleDisabled]}
              numberOfLines={1}
            >
              {item.name || item.ownerName}
            </Text>
            {!eligible ? (
              <View style={styles.notInGroupBadge}>
                <Text style={styles.notInGroupText}>
                  {!isSharedAnywhere ? 'Not shared' : 'Not in group'}
                </Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.rowSubtitle} numberOfLines={2}>
            {BANK_DICTIONARY[item.bankName] || item.bankName} · {item.number.slice(-4)}
            {sharedGroupNames.length > 0
              ? ` · Shared with ${sharedGroupNames.join(', ')}`
              : ' · Not shared'}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderGroup = ({ item }: { item: GroupOption }) => {
    const selected = selectedGroupId === item.groupId;
    return (
      <TouchableOpacity
        style={[styles.row, selected && styles.rowSelected]}
        onPress={() => setSelectedGroupId(item.groupId)}
      >
        <Icon
          source={selected ? 'radiobox-marked' : 'radiobox-blank'}
          size={22}
          color="#111111"
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle} numberOfLines={1}>{item.name}</Text>
          <Text style={styles.rowSubtitle} numberOfLines={1}>{item.subtitle}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {lockedGroupId && lockedGroup ? (
          <>
            <View style={styles.destinationBanner}>
              <Icon source="account-group" size={24} color="#111111" />
              <View style={{ flex: 1, marginHorizontal: 8 }}>
                <Text style={styles.destinationLabel}>Unsharing from group</Text>
                <Text style={styles.destinationName} numberOfLines={1}>
                  {lockedGroup.name}
                </Text>
              </View>
              <View style={styles.destinationBadge}>
                <Text style={styles.destinationBadgeText}>{lockedGroup.memberCount} members</Text>
              </View>
            </View>

            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>
                Select cards ({eligibleSelectedCards.length} selected)
              </Text>
              {eligibleCards.length > 0 && (
                <TouchableOpacity onPress={handleToggleSelectAll} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={styles.selectAllText}>
                    {eligibleSelectedCards.length === eligibleCards.length ? 'Deselect all' : 'Select all'}
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
                  <Text style={styles.emptyTitle}>No shared cards</Text>
                  <Text style={styles.emptyText}>None of your cards are currently shared.</Text>
                </View>
              }
            />
          </>
        ) : (
          <View style={styles.splitHalfContainer}>
            <View style={styles.halfSection}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>
                  Select cards ({eligibleSelectedCards.length} selected)
                </Text>
                {eligibleCards.length > 0 && (
                  <TouchableOpacity onPress={handleToggleSelectAll} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={styles.selectAllText}>
                      {eligibleSelectedCards.length === eligibleCards.length ? 'Deselect all' : 'Select all'}
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
                    <Text style={styles.emptyTitle}>No shared cards</Text>
                    <Text style={styles.emptyText}>None of your cards are currently shared.</Text>
                  </View>
                }
              />
            </View>

            <View style={styles.halfSection}>
              <Text style={styles.sectionTitle}>Unshare from group</Text>
              <FlatList
                data={groupOptions}
                keyExtractor={(item) => item.groupId}
                renderItem={renderGroup}
                style={styles.halfList}
                contentContainerStyle={groupOptions.length === 0 ? styles.emptyContainer : { paddingBottom: 6 }}
                ListEmptyComponent={<Text style={styles.emptyText}>No groups available.</Text>}
              />
            </View>
          </View>
        )}
      </View>

      <View style={styles.bottomFooter}>
        <View style={styles.confirmBox}>
          {eligibleSelectedCards.length > 0 ? (
            <Text style={styles.confirmText} numberOfLines={2}>
              Unsharing {eligibleSelectedCards.length} card{eligibleSelectedCards.length === 1 ? '' : 's'} from {targetGroupName}
              {ineligibleSelectedCount > 0 ? ` (${ineligibleSelectedCount} not in group)` : ''}
            </Text>
          ) : (
            <Text style={[styles.confirmText, { color: '#6B7280' }]} numberOfLines={2}>
              {selectedCardIds.length > 0
                ? `None of the selected cards are in ${targetGroupName}`
                : `Select cards to unshare from ${targetGroupName}`}
            </Text>
          )}
        </View>

        <Button
          mode="contained"
          onPress={handleUnshare}
          loading={saving}
          disabled={saving || !selectedGroupId || eligibleSelectedCards.length === 0}
          style={[
            styles.unshareButton,
            (!selectedGroupId || eligibleSelectedCards.length === 0) && { opacity: 0.55 },
          ]}
          labelStyle={{ color: '#FFFFFF', fontWeight: '700' }}
        >
          {eligibleSelectedCards.length > 0
            ? `Unshare (${eligibleSelectedCards.length} card${eligibleSelectedCards.length === 1 ? '' : 's'})`
            : 'Unshare'}
        </Button>
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
