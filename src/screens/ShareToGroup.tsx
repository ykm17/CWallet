import React, { useContext, useEffect, useMemo, useState, useRef } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  SafeAreaView,
  Platform,
  TextInput,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
} from 'react-native';
import { Alert } from '../components/CustomAlert';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, Icon, Text } from 'react-native-paper';
import auth from '@react-native-firebase/auth';
import { getFirestore, collection, onSnapshot, query, where } from '@react-native-firebase/firestore';
import { RootStackParamList } from '../App';
import { Card, Group, SharedPerson, WalletUser } from '../types/Types';
import { useUserGroups } from '../hooks/useUserGroups';
import { parseCardDocument } from '../services/cardService';
import {
  shareCardsWithGroup,
  shareCardsWithGroups,
  shareCardsWithPerson,
  unshareCardFromGroup,
} from '../services/sharingService';
import {
  canShareToGroup,
  contributionLabel,
  isSelfRecipient,
  sortCardsByLatest,
  validateRecipientIdentifier,
} from '../services/sharingUtils';
import { findRegisteredUser, getAppleUserId } from '../services/userService';
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
  const [mode, setMode] = useState<'groups' | 'person'>('groups');
  const [ownedCards, setOwnedCards] = useState<Card[]>([]);
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>(initialCardIds);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>(
    lockedGroupId ? [lockedGroupId] : [],
  );
  const [recipientInput, setRecipientInput] = useState('');
  const [registeredUser, setRegisteredUser] = useState<WalletUser | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

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
      setOwnedCards(sortCardsByLatest(cards));
    });
  }, [uid]);

  const recipientValidation = useMemo(
    () => validateRecipientIdentifier(recipientInput),
    [recipientInput],
  );

  // Look up recipient user whenever a valid identifier is entered
  useEffect(() => {
    if (!recipientValidation.isValid) {
      setRegisteredUser(null);
      setLookupLoading(false);
      return;
    }
    let active = true;
    setLookupLoading(true);
    findRegisteredUser(recipientValidation.identifier)
      .then((user) => {
        if (active) {
          setRegisteredUser(user);
          setLookupLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setRegisteredUser(null);
          setLookupLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [recipientValidation.isValid, recipientValidation.identifier]);

  const currentUser = auth().currentUser;
  const currentEmail = currentUser?.email?.toLowerCase().trim() || '';
  const currentAppleId = getAppleUserId(currentUser) || '';

  const isSelf = useMemo(() => {
    if (!recipientValidation.isValid) return false;
    if (isSelfRecipient(recipientValidation.identifier, { uid, email: currentEmail, appleUserId: currentAppleId })) {
      return true;
    }
    if (registeredUser && registeredUser.uid === uid) {
      return true;
    }
    return false;
  }, [recipientValidation, uid, currentEmail, currentAppleId, registeredUser]);

  // Unique list of people previously shared with across all owned cards (excluding self)
  const previouslySharedPeople = useMemo(() => {
    const map = new Map<string, SharedPerson>();
    ownedCards.forEach((c) => {
      (c.sharedWithUsers || []).forEach((p) => {
        const key = p.email?.toLowerCase() || p.appleUserId || p.recipientUid || '';
        if (!key) return;
        if (p.recipientUid === uid) return;
        if (isSelfRecipient(key, { uid, email: currentEmail, appleUserId: currentAppleId })) return;
        if (!map.has(key)) {
          map.set(key, p);
        }
      });
    });
    return Array.from(map.values());
  }, [ownedCards, uid, currentEmail, currentAppleId]);

  const availableGroups = useMemo(
    () => (lockedGroupId ? groups.filter((group) => group.groupId === lockedGroupId) : shareableGroups),
    [groups, lockedGroupId, shareableGroups],
  );

  const selectedGroups = useMemo(
    () => availableGroups.filter((group) => selectedGroupIds.includes(group.groupId)),
    [availableGroups, selectedGroupIds],
  );

  const selectedGroup = selectedGroups[0];

  const shareableAvailableGroupIds = useMemo(
    () => availableGroups.filter((g) => canShareToGroup(g, uid)).map((g) => g.groupId),
    [availableGroups, uid],
  );

  const groupNameById = useMemo(
    () => groups.reduce<Record<string, string>>((acc, g) => { acc[g.groupId] = g.name; return acc; }, {}),
    [groups],
  );

  // List of { cardId, groupId } pairs that need to be shared
  const newSharePairs = useMemo(() => {
    if (selectedGroupIds.length === 0 || selectedCardIds.length === 0) return [];
    const pairs: Array<{ cardId: string; groupId: string }> = [];
    for (const cardId of selectedCardIds) {
      const card = ownedCards.find((c) => c.key === cardId);
      const cardSharedGroupIds = card?.sharedGroupIds || [];
      for (const groupId of selectedGroupIds) {
        if (!cardSharedGroupIds.includes(groupId)) {
          pairs.push({ cardId, groupId });
        }
      }
    }
    return pairs;
  }, [selectedCardIds, selectedGroupIds, ownedCards]);

  const totalPossibleShares = selectedCardIds.length * selectedGroupIds.length;
  const alreadySharedPairsCount = totalPossibleShares - newSharePairs.length;

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

  const toggleGroup = (groupId: string) => {
    if (lockedGroupId) return;
    setSelectedGroupIds((prev) => (
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]
    ));
  };

  const handleToggleSelectAllGroups = () => {
    if (lockedGroupId) return;
    if (selectedGroupIds.length === shareableAvailableGroupIds.length) {
      setSelectedGroupIds([]);
    } else {
      setSelectedGroupIds(shareableAvailableGroupIds);
    }
  };

  const handleShareToGroups = async () => {
    if (saving || savingRef.current) return;
    if (!isConnected) {
      Alert.alert('Offline', 'You must be online to share cards with groups.');
      return;
    }
    if (selectedGroupIds.length === 0) {
      Alert.alert('Select groups', 'Please select at least one destination group to share with.');
      return;
    }
    if (selectedCardIds.length === 0) {
      Alert.alert('Select cards', 'Choose at least one card to share.');
      return;
    }
    if (newSharePairs.length === 0) {
      Alert.alert(
        'Already Shared',
        'All selected cards are already shared with the selected groups.',
      );
      return;
    }

    const groupNamesText = selectedGroups.length <= 2
      ? selectedGroups.map((g) => g.name).join(' & ')
      : `${selectedGroups.length} groups (${selectedGroups.map((g) => g.name).join(', ')})`;

    const confirmMessage =
      alreadySharedPairsCount === 0
        ? `Share ${selectedCardIds.length} card${selectedCardIds.length === 1 ? '' : 's'} with ${groupNamesText}? Members will be able to view them. Ownership will not change.`
        : `Share ${selectedCardIds.length} card${selectedCardIds.length === 1 ? '' : 's'} with ${groupNamesText}? (${alreadySharedPairsCount} already shared mapping${alreadySharedPairsCount === 1 ? ' is' : 's are'} skipped).`;

    Alert.alert(
      'Confirm Share',
      confirmMessage,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Share',
          onPress: async () => {
            if (savingRef.current) return;
            try {
              savingRef.current = true;
              setSaving(true);
              const result = await shareCardsWithGroups(selectedCardIds, selectedGroupIds);
              Alert.alert(
                'Cards shared',
                `${result.shared} new card sharing mapping${result.shared === 1 ? '' : 's'} created across ${selectedGroupIds.length} group${selectedGroupIds.length === 1 ? '' : 's'}.`,
                [{ text: 'OK', onPress: () => navigation.goBack() }],
              );
            } catch (error: any) {
              Alert.alert('Could not share cards', error.message || 'Please try again.');
            } finally {
              savingRef.current = false;
              setSaving(false);
            }
          },
        },
      ],
    );
  };

  const handleShareWithPerson = async () => {
    if (saving || savingRef.current) return;
    if (!isConnected) {
      Alert.alert('Offline', 'You must be online to share cards with a person.');
      return;
    }
    if (selectedCardIds.length === 0) {
      Alert.alert('Select cards', 'Choose at least one card to share.');
      return;
    }
    if (!recipientValidation.isValid) {
      Alert.alert('Invalid recipient', recipientValidation.error || 'Please enter a valid email or Apple ID.');
      return;
    }
    if (isSelf) {
      Alert.alert('Cannot share with yourself', 'You are the owner of these cards and already have full access.');
      return;
    }

    const targetName = registeredUser?.displayName || recipientValidation.identifier;
    const confirmMessage = registeredUser
      ? `Share ${selectedCardIds.length} card${selectedCardIds.length === 1 ? '' : 's'} with ${targetName}? They will be able to view them immediately.`
      : `Share ${selectedCardIds.length} card${selectedCardIds.length === 1 ? '' : 's'} with ${recipientValidation.identifier}? If they haven't joined yet, cards will automatically appear when they sign in.`;

    Alert.alert(
      'Confirm Share',
      confirmMessage,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Share',
          onPress: async () => {
            if (savingRef.current) return;
            try {
              savingRef.current = true;
              setSaving(true);
              const result = await shareCardsWithPerson(
                selectedCardIds,
                recipientValidation.identifier,
              );
              const notice = result.isPending
                ? `An invitation is pending. ${result.shared} card${result.shared === 1 ? '' : 's'} will be available as soon as they sign in.`
                : `${result.shared} card${result.shared === 1 ? '' : 's'} shared with ${result.recipientName || recipientValidation.identifier}.`;
              Alert.alert('Cards shared', notice, [{ text: 'OK', onPress: () => navigation.goBack() }]);
            } catch (error: any) {
              Alert.alert('Could not share cards', error.message || 'Please try again.');
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

    return (
      <TouchableOpacity
        style={[
          styles.row,
          selected && styles.rowSelected,
        ]}
        onPress={() => {
          toggleCard(item.key);
        }}
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
          </View>
          <Text style={styles.rowSubtitle} numberOfLines={2}>
            {BANK_DICTIONARY[item.bankName] || item.bankName} · {item.number.slice(-4)}
            {allSharedNames.length > 0
              ? ` · Shared with ${allSharedNames.join(', ')}`
              : ''}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderGroup = ({ item }: { item: Group }) => {
    const selected = selectedGroupIds.includes(item.groupId);
    const allowed = canShareToGroup(item, uid);
    return (
      <TouchableOpacity
        style={[styles.row, selected && styles.rowSelected, !allowed && styles.rowDisabled]}
        onPress={() => allowed && toggleGroup(item.groupId)}
        disabled={!allowed}
        activeOpacity={0.7}
      >
        <Icon
          source={selected ? 'checkbox-marked' : 'checkbox-blank-outline'}
          size={22}
          color={!allowed ? '#D1D5DB' : selected ? '#111111' : '#9CA3AF'}
        />
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
      <KeyboardAvoidingView
        style={styles.keyboardContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
      >
        <View style={styles.content}>
          {!isConnected && (
            <View style={styles.offlineBanner}>
              <Icon source="cloud-off-outline" size={16} color="#B91C1C" />
              <Text style={styles.offlineBannerText}>You are offline. Sharing cards is disabled.</Text>
            </View>
          )}

          {/* Segmented Control: Groups vs Person (hidden when locked to a specific group) */}
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
                  source="account-plus-outline"
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
          ) : mode === 'groups' ? (
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
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionTitle}>
                    Select groups ({selectedGroupIds.length} selected)
                  </Text>
                  {shareableAvailableGroupIds.length > 0 && !lockedGroupId && (
                    <TouchableOpacity onPress={handleToggleSelectAllGroups} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Text style={styles.selectAllText}>
                        {selectedGroupIds.length === shareableAvailableGroupIds.length ? 'Deselect all' : 'Select all'}
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
                  ListEmptyComponent={<Text style={styles.emptyText}>Join or create a group first.</Text>}
                />
              </View>
            </View>
          ) : (
            /* Person Mode - Recipient Input at top with scrollable cards below */
            <FlatList
              data={ownedCards}
              keyExtractor={(item) => item.key}
              renderItem={renderCard}
              style={styles.personList}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              contentContainerStyle={ownedCards.length === 0 ? styles.emptyContainer : { paddingBottom: 16 }}
              ListHeaderComponent={
                <View style={styles.personHeaderContainer}>
                  <View style={styles.personCardContainer}>
                    <View style={styles.personCardHeader}>
                      <Icon source="account-plus" size={20} color="#111111" />
                      <Text style={styles.personCardTitle}>Share with a person</Text>
                    </View>
                    <Text style={styles.personCardSubtitle}>
                      Enter their Email address or Apple ID. If they haven't registered yet, cards will appear when they join.
                    </Text>

                    <View style={styles.inputWrapper}>
                      <Icon
                        source={recipientInput.includes('@') ? 'email-outline' : 'account-outline'}
                        size={20}
                        color="#6B7280"
                      />
                      <TextInput
                        style={styles.textInput}
                        placeholder="Email or Apple ID"
                        placeholderTextColor="#9CA3AF"
                        value={recipientInput}
                        onChangeText={setRecipientInput}
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType="email-address"
                      />
                      {lookupLoading && (
                        <ActivityIndicator size="small" color="#111111" style={{ marginRight: 6 }} />
                      )}
                      {recipientInput.length > 0 && (
                        <TouchableOpacity onPress={() => setRecipientInput('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <Icon source="close-circle" size={18} color="#9CA3AF" />
                        </TouchableOpacity>
                      )}
                    </View>

                    {/* Status / Lookup Feedback */}
                    {recipientInput.trim().length > 0 && (
                      <View style={styles.statusBox}>
                        {isSelf ? (
                          <View style={[styles.statusPill, styles.statusPillWarning]}>
                            <Icon source="alert-circle-outline" size={14} color="#B45309" />
                            <Text style={styles.statusPillTextWarning}>
                              You cannot share cards with yourself.
                            </Text>
                          </View>
                        ) : !recipientValidation.isValid ? (
                          <View style={[styles.statusPill, styles.statusPillWarning]}>
                            <Icon source="alert-circle-outline" size={14} color="#B45309" />
                            <Text style={styles.statusPillTextWarning}>
                              {recipientValidation.error || 'Enter a valid email or Apple ID'}
                            </Text>
                          </View>
                        ) : registeredUser ? (
                          <View style={[styles.statusPill, styles.statusPillSuccess]}>
                            <Icon source="check-circle" size={14} color="#047857" />
                            <Text style={styles.statusPillTextSuccess}>
                              Registered: {registeredUser.displayName || registeredUser.email}
                            </Text>
                          </View>
                        ) : (
                          <View style={[styles.statusPill, styles.statusPillInfo]}>
                            <Icon source="clock-outline" size={14} color="#1D4ED8" />
                            <Text style={styles.statusPillTextInfo}>
                              Invitation pending (will sync when they register)
                            </Text>
                          </View>
                        )}
                      </View>
                    )}

                    {/* Suggested / Previously shared people */}
                    {previouslySharedPeople.length > 0 && (
                      <View style={styles.suggestionsSection}>
                        <Text style={styles.suggestionsTitle}>Previously shared with:</Text>
                        <ScrollView
                          horizontal
                          showsHorizontalScrollIndicator={false}
                          keyboardShouldPersistTaps="handled"
                          contentContainerStyle={styles.suggestionsList}
                        >
                          {previouslySharedPeople.map((person, idx) => {
                            const label = person.displayName || person.email || person.appleUserId || '';
                            const identifier = person.email || person.appleUserId || '';
                            if (!identifier) return null;
                            const isCurrent = recipientInput.trim().toLowerCase() === identifier.toLowerCase();
                            return (
                              <TouchableOpacity
                                key={`${identifier}-${idx}`}
                                style={[styles.suggestionChip, isCurrent && styles.suggestionChipActive]}
                                onPress={() => setRecipientInput(identifier)}
                                activeOpacity={0.7}
                              >
                                <Icon
                                  source={person.email ? 'email-outline' : 'apple'}
                                  size={14}
                                  color={isCurrent ? '#FFFFFF' : '#374151'}
                                />
                                <Text
                                  style={[styles.suggestionChipText, isCurrent && styles.suggestionChipTextActive]}
                                  numberOfLines={1}
                                >
                                  {label}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </ScrollView>
                      </View>
                    )}
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
                </View>
              }
              ListEmptyComponent={
                <View style={styles.emptyCardBox}>
                  <Icon source="credit-card-outline" size={32} color="#9CA3AF" />
                  <Text style={styles.emptyTitle}>No cards in your wallet</Text>
                  <Text style={styles.emptyText}>Add cards to your wallet first.</Text>
                </View>
              }
            />
          )}
        </View>

        <View style={styles.bottomFooter}>
          {mode === 'groups' ? (
            <>
              {selectedGroupIds.length > 0 && (
                <View style={styles.confirmBox}>
                  <Text style={[styles.confirmText, newSharePairs.length === 0 && { color: '#6B7280' }]} numberOfLines={2}>
                    {newSharePairs.length > 0
                      ? `Sharing ${selectedCardIds.length} card${selectedCardIds.length === 1 ? '' : 's'} across ${selectedGroupIds.length} group${selectedGroupIds.length === 1 ? '' : 's'} (${newSharePairs.length} new mapping${newSharePairs.length === 1 ? '' : 's'}${alreadySharedPairsCount > 0 ? `, ${alreadySharedPairsCount} skipped` : ''})`
                      : selectedCardIds.length > 0
                      ? `All selected cards are already in the selected group${selectedGroupIds.length === 1 ? '' : 's'}`
                      : `Select cards to share with ${selectedGroupIds.length} group${selectedGroupIds.length === 1 ? '' : 's'}`}
                  </Text>
                </View>
              )}

              <Button
                mode="contained"
                onPress={handleShareToGroups}
                loading={saving}
                disabled={saving || !isConnected || selectedGroupIds.length === 0 || selectedCardIds.length === 0 || newSharePairs.length === 0}
                style={[
                  styles.shareButton,
                  (!isConnected || selectedGroupIds.length === 0 || selectedCardIds.length === 0 || newSharePairs.length === 0) && { opacity: 0.55 },
                ]}
                labelStyle={{ color: '#FFFFFF', fontWeight: '700' }}
              >
                {!isConnected
                  ? 'Offline (Cannot share)'
                  : selectedGroupIds.length === 0
                  ? 'Select groups'
                  : selectedCardIds.length === 0
                  ? 'Select cards'
                  : newSharePairs.length === 0
                  ? 'Already in selected groups'
                  : `Share (${newSharePairs.length} new)`}
              </Button>
            </>
          ) : (
            /* Person Mode Footer */
            <>
              <View style={styles.confirmBox}>
                <Text style={[styles.confirmText, isSelf && { color: '#B45309' }]} numberOfLines={2}>
                  {isSelf
                    ? 'You are the owner of these cards and cannot share them with yourself'
                    : selectedCardIds.length === 0
                    ? 'Select cards above to share'
                    : !recipientValidation.isValid
                    ? 'Enter an email address or Apple ID above'
                    : `Share ${selectedCardIds.length} card${selectedCardIds.length === 1 ? '' : 's'} with ${registeredUser?.displayName || recipientValidation.identifier}`}
                </Text>
              </View>

              <Button
                mode="contained"
                onPress={handleShareWithPerson}
                loading={saving}
                disabled={
                  saving ||
                  !isConnected ||
                  selectedCardIds.length === 0 ||
                  !recipientValidation.isValid ||
                  isSelf
                }
                style={[
                  styles.shareButton,
                  (!isConnected || selectedCardIds.length === 0 || !recipientValidation.isValid || isSelf) && {
                    opacity: 0.55,
                  },
                ]}
                labelStyle={{ color: '#FFFFFF', fontWeight: '700' }}
              >
                {!isConnected
                  ? 'Offline (Cannot share)'
                  : isSelf
                  ? 'Cannot share with yourself'
                  : selectedCardIds.length === 0
                  ? 'Select cards'
                  : !recipientValidation.isValid
                  ? 'Enter recipient'
                  : `Share with person (${selectedCardIds.length} card${selectedCardIds.length === 1 ? '' : 's'})`}
              </Button>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
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
  keyboardContainer: {
    flex: 1,
  },
  personHeaderContainer: {
    marginBottom: 4,
  },
  personList: {
    flex: 1,
  },
  personCardContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 10,
  },
  personCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  personCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111111',
  },
  personCardSubtitle: {
    fontSize: 12,
    color: '#6B7280',
    lineHeight: 16,
    marginBottom: 12,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 10,
    height: 44,
    gap: 8,
  },
  textInput: {
    flex: 1,
    fontSize: 14,
    color: '#111111',
    paddingVertical: 0,
  },
  statusBox: {
    marginTop: 8,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  statusPillWarning: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
    borderWidth: 1,
  },
  statusPillTextWarning: {
    fontSize: 11,
    color: '#B45309',
    fontWeight: '600',
    flex: 1,
  },
  statusPillSuccess: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
    borderWidth: 1,
  },
  statusPillTextSuccess: {
    fontSize: 11,
    color: '#047857',
    fontWeight: '600',
    flex: 1,
  },
  statusPillInfo: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
    borderWidth: 1,
  },
  statusPillTextInfo: {
    fontSize: 11,
    color: '#1D4ED8',
    fontWeight: '600',
    flex: 1,
  },
  suggestionsSection: {
    marginTop: 14,
  },
  suggestionsTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  suggestionsList: {
    gap: 8,
    paddingVertical: 2,
  },
  suggestionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  suggestionChipActive: {
    backgroundColor: '#111111',
    borderColor: '#111111',
  },
  suggestionChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#374151',
    maxWidth: 160,
  },
  suggestionChipTextActive: {
    color: '#FFFFFF',
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
