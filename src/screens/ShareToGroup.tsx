import React, { useContext, useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, Alert, SafeAreaView, Platform } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, Icon, Text } from 'react-native-paper';
import auth from '@react-native-firebase/auth';
import { getFirestore, collection, onSnapshot, query, where } from '@react-native-firebase/firestore';
import { RootStackParamList } from '../App';
import { Card, Group } from '../types/Types';
import { useUserGroups } from '../hooks/useUserGroups';
import { parseCardDocument } from '../services/cardService';
import { shareCardsWithGroup, unshareCardFromGroup } from '../services/sharingService';
import { canShareToGroup, contributionLabel } from '../services/sharingUtils';
import { BANK_COLORS, BANK_DICTIONARY } from '../constants/Constants';
import { COLLECTIONS as FIRESTORE_COLLECTIONS } from '../constants/Firestore';
import { ConnectivityContext } from '../util/Connectivity';

type Props = NativeStackScreenProps<RootStackParamList, 'ShareToGroup'>;

const ShareToGroup: React.FC<Props> = ({ navigation, route }) => {
  const uid = auth().currentUser?.uid || '';
  const initialCardIds = route.params?.cardIds || [];
  const lockedGroupId = route.params?.groupId;
  const { isConnected } = useContext(ConnectivityContext);
  const { groups, shareableGroups } = useUserGroups();
  const [ownedCards, setOwnedCards] = useState<Card[]>([]);
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>(initialCardIds);
  const [selectedGroupId, setSelectedGroupId] = useState<string | undefined>(lockedGroupId);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    navigation.setOptions({
      title: 'Share cards',
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

  const availableGroups = useMemo(
    () => (lockedGroupId ? groups.filter((group) => group.groupId === lockedGroupId) : shareableGroups),
    [groups, lockedGroupId, shareableGroups],
  );
  const selectedGroup = availableGroups.find((group) => group.groupId === selectedGroupId);

  const groupNameById = useMemo(
    () => groups.reduce<Record<string, string>>((acc, g) => { acc[g.groupId] = g.name; return acc; }, {}),
    [groups],
  );

  const isCardAlreadySharedWithSelected = (card: Card) => {
    if (!selectedGroupId) return false;
    return (card.sharedGroupIds || []).includes(selectedGroupId);
  };

  const newCardsToShare = useMemo(() => {
    if (!selectedGroupId) return [];
    return selectedCardIds.filter((id) => {
      const card = ownedCards.find((c) => c.key === id);
      return card && !isCardAlreadySharedWithSelected(card);
    });
  }, [selectedCardIds, ownedCards, selectedGroupId]);

  const alreadySharedSelectedCount = selectedCardIds.length - newCardsToShare.length;

  const toggleCard = (cardId: string) => {
    setSelectedCardIds((prev) => (
      prev.includes(cardId) ? prev.filter((id) => id !== cardId) : [...prev, cardId]
    ));
  };

  const handleToggleSelectAll = () => {
    if (selectedCardIds.length === ownedCards.length) {
      setSelectedCardIds([]);
    } else {
      setSelectedCardIds(ownedCards.map((c) => c.key));
    }
  };

  const handleShare = async () => {
    if (!isConnected) {
      Alert.alert('Offline', 'You must be online to share cards with groups.');
      return;
    }
    if (!selectedGroupId) {
      Alert.alert('Select a group', 'Please select a destination group to share with.');
      return;
    }
    const group = availableGroups.find((item) => item.groupId === selectedGroupId);
    if (group && !canShareToGroup(group, uid)) {
      Alert.alert('Sharing not allowed', 'This group is owner-controlled.');
      return;
    }
    if (selectedCardIds.length === 0) {
      Alert.alert('Select cards', 'Choose at least one card to share.');
      return;
    }
    if (newCardsToShare.length === 0) {
      Alert.alert(
        'Already Shared',
        `All selected cards are already shared with ${selectedGroup?.name || 'this group'}.`,
      );
      return;
    }

    const confirmMessage =
      newCardsToShare.length === selectedCardIds.length
        ? `Share ${newCardsToShare.length} card${newCardsToShare.length === 1 ? '' : 's'} with ${selectedGroup?.name}? Members will be able to view them. Ownership will not change.`
        : `Share ${newCardsToShare.length} new card${newCardsToShare.length === 1 ? '' : 's'} with ${selectedGroup?.name}? (${alreadySharedSelectedCount} card${alreadySharedSelectedCount === 1 ? ' is' : 's are'} already shared and will be skipped).`;

    Alert.alert(
      'Confirm Share',
      confirmMessage,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Share',
          onPress: async () => {
            try {
              setSaving(true);
              const result = await shareCardsWithGroup(newCardsToShare, selectedGroupId);
              Alert.alert(
                'Cards shared',
                `${result.shared} new card${result.shared === 1 ? '' : 's'} shared with ${selectedGroup?.name}.`,
                [{ text: 'OK', onPress: () => navigation.goBack() }],
              );
            } catch (error: any) {
              Alert.alert('Could not share cards', error.message || 'Please try again.');
            } finally {
              setSaving(false);
            }
          },
        },
      ],
    );
  };

  const renderCard = ({ item }: { item: Card }) => {
    const isAlreadyShared = isCardAlreadySharedWithSelected(item);
    const selected = selectedCardIds.includes(item.key);
    const sharedGroupNames = (item.sharedGroupIds || [])
      .map((gid) => groupNameById[gid])
      .filter(Boolean);

    return (
      <TouchableOpacity
        style={[
          styles.row,
          selected && !isAlreadyShared && styles.rowSelected,
          isAlreadyShared && styles.rowAlreadyShared,
        ]}
        onPress={() => {
          if (isAlreadyShared) {
            Alert.alert(
              'Already in Group',
              `"${item.name || item.ownerName}" is already shared with ${selectedGroup?.name}. Would you like to unshare it?`,
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Unshare',
                  style: 'destructive',
                  onPress: async () => {
                    if (!isConnected) {
                      Alert.alert('Offline', 'You must be online to unshare cards.');
                      return;
                    }
                    try {
                      await unshareCardFromGroup(item.key, selectedGroupId!);
                      Alert.alert('Card Unshared', `Removed from ${selectedGroup?.name}.`);
                    } catch (err: any) {
                      Alert.alert('Could not unshare card', err.message || 'Please try again.');
                    }
                  },
                },
              ],
            );
            return;
          }
          toggleCard(item.key);
        }}
        activeOpacity={isAlreadyShared ? 0.9 : 0.7}
      >
        <Icon
          source={
            isAlreadyShared
              ? 'check-circle'
              : selected
              ? 'checkbox-marked'
              : 'checkbox-blank-outline'
          }
          size={22}
          color={isAlreadyShared ? '#10B981' : selected ? '#111111' : '#9CA3AF'}
        />
        <View style={[styles.bankIndicator, { backgroundColor: BANK_COLORS[item.bankName] || '#1B1B1B' }]} />
        <View style={{ flex: 1 }}>
          <View style={styles.cardTitleRow}>
            <Text
              style={[styles.rowTitle, isAlreadyShared && styles.rowTitleAlreadyShared]}
              numberOfLines={1}
            >
              {item.name || item.ownerName}
            </Text>
            {isAlreadyShared ? (
              <View style={styles.alreadySharedBadge}>
                <Text style={styles.alreadySharedText}>Already in group</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.rowSubtitle} numberOfLines={2}>
            {BANK_DICTIONARY[item.bankName] || item.bankName} · {item.number.slice(-4)}
            {!isAlreadyShared && sharedGroupNames.length > 0
              ? ` · Shared with ${sharedGroupNames.join(', ')}`
              : ''}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderGroup = ({ item }: { item: Group }) => {
    const selected = selectedGroupId === item.groupId;
    const allowed = canShareToGroup(item, uid);
    return (
      <TouchableOpacity
        style={[styles.row, selected && styles.rowSelected, !allowed && styles.rowDisabled]}
        onPress={() => allowed && setSelectedGroupId(item.groupId)}
        disabled={!allowed}
      >
        <Icon source={selected ? 'radiobox-marked' : 'radiobox-blank'} size={22} color={allowed ? '#111111' : '#D1D5DB'} />
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle} numberOfLines={1}>{item.name}</Text>
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {item.memberCount} members · {contributionLabel(item.contributionPermission)}
            {item.ownerId === uid ? ' · Your group' : ''}
            {!allowed ? ' · Owner-controlled' : ''}
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
            <Text style={styles.offlineBannerText}>You are offline. Sharing cards with groups is disabled.</Text>
          </View>
        )}
        {lockedGroupId && selectedGroup ? (
          <>
            <View style={styles.destinationBanner}>
              <Icon source="account-group" size={24} color="#111111" />
              <View style={{ flex: 1, marginHorizontal: 8 }}>
                <Text style={styles.destinationLabel}>Sharing with group</Text>
                <Text style={styles.destinationName} numberOfLines={1}>
                  {selectedGroup.name}
                </Text>
              </View>
              <View style={styles.destinationBadge}>
                <Text style={styles.destinationBadgeText}>{selectedGroup.memberCount} members</Text>
              </View>
            </View>

            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Select cards ({selectedCardIds.length} selected)</Text>
              {ownedCards.length > 0 && (
                <TouchableOpacity onPress={handleToggleSelectAll} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
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
                  <Icon source="credit-card-outline" size={36} color="#9CA3AF" />
                  <Text style={styles.emptyTitle}>No cards in your wallet</Text>
                  <Text style={styles.emptyText}>Add cards to your wallet first before sharing.</Text>
                </View>
              }
            />
          </>
        ) : (
          <View style={styles.splitHalfContainer}>
            <View style={styles.halfSection}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>Select cards ({selectedCardIds.length} selected)</Text>
                {ownedCards.length > 0 && (
                  <TouchableOpacity onPress={handleToggleSelectAll} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
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
                    <Icon source="credit-card-outline" size={32} color="#9CA3AF" />
                    <Text style={styles.emptyTitle}>No cards in your wallet</Text>
                    <Text style={styles.emptyText}>Add cards to your wallet first.</Text>
                  </View>
                }
              />
            </View>

            <View style={styles.halfSection}>
              <Text style={styles.sectionTitle}>Share with one group</Text>
              <FlatList
                data={availableGroups}
                keyExtractor={(item) => item.groupId}
                renderItem={renderGroup}
                style={styles.halfList}
                contentContainerStyle={availableGroups.length === 0 ? styles.emptyContainer : { paddingBottom: 6 }}
                ListEmptyComponent={<Text style={styles.emptyText}>Join or create a group first.</Text>}
              />
            </View>
          </View>
        )}
      </View>

      <View style={styles.bottomFooter}>
        {selectedGroup && (
          <View style={styles.confirmBox}>
            <Text style={[styles.confirmText, newCardsToShare.length === 0 && { color: '#6B7280' }]} numberOfLines={2}>
              {newCardsToShare.length > 0
                ? `Sharing ${newCardsToShare.length} new card${newCardsToShare.length === 1 ? '' : 's'} with ${selectedGroup.name}${alreadySharedSelectedCount > 0 ? ` (${alreadySharedSelectedCount} already in group)` : ''}`
                : selectedCardIds.length > 0
                ? `All selected cards are already in ${selectedGroup.name}`
                : `Select cards to share with ${selectedGroup.name}`}
            </Text>
          </View>
        )}

        <Button
          mode="contained"
          onPress={handleShare}
          loading={saving}
          disabled={saving || !isConnected || !selectedGroupId || (selectedCardIds.length > 0 && newCardsToShare.length === 0)}
          style={[
            styles.shareButton,
            (!isConnected || !selectedGroupId || (selectedCardIds.length > 0 && newCardsToShare.length === 0)) && { opacity: 0.55 },
          ]}
          labelStyle={{ color: '#FFFFFF', fontWeight: '700' }}
        >
          {!isConnected
            ? 'Offline (Cannot share)'
            : selectedGroup && selectedCardIds.length > 0 && newCardsToShare.length === 0
            ? 'Already in this group'
            : newCardsToShare.length > 0
            ? `Share (${newCardsToShare.length} new)`
            : 'Share'}
        </Button>
      </View>
    </SafeAreaView>
  );
};

export default ShareToGroup;

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
  rowAlreadyShared: {
    backgroundColor: '#F9FAFB',
    borderColor: '#E5E7EB',
    borderWidth: 1,
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
  rowTitleAlreadyShared: {
    color: '#374151',
  },
  alreadySharedBadge: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    flexShrink: 0,
  },
  alreadySharedText: {
    color: '#065F46',
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
  shareButton: {
    backgroundColor: '#111111',
    borderRadius: 8,
  },
});
