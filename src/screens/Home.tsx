import { View, StyleSheet, TouchableOpacity, FlatList, BackHandler, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import React, { useContext, useEffect, useMemo, useState, useRef } from 'react';
import { Alert } from '../components/CustomAlert';
import CustomCard from '../components/CustomCard';
import CardFormModal from '../components/CardFormModal';
import ShareCardModal from '../components/ShareCardModal';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../App';
import auth from '@react-native-firebase/auth';
import { Card } from '../types/Types';
import { FAB, Text, SegmentedButtons, Searchbar, Icon, Dialog, Portal } from 'react-native-paper';
import { isEmpty } from 'lodash';
import { BANK_DICTIONARY, CARD_NETWORKS, CARD_TYPES } from '../constants/Constants';
import { getFirestore, collection, doc, addDoc, updateDoc, query, where, onSnapshot, serverTimestamp, getDocs } from '@react-native-firebase/firestore';
import { encryptCardData } from '../util/Crypto';
import { ConnectivityContext } from '../util/Connectivity';
import { detectCardType } from '../util/Utils';
import EncryptedStorage from 'react-native-encrypted-storage';
import { parseCardDocument } from '../services/cardService';
import { sortCardsByLatest } from '../services/sharingUtils';
import { useUserGroups } from '../hooks/useUserGroups';
import { useAccessibleCards } from '../hooks/useAccessibleCards';
import { upsertCurrentUserProfile } from '../services/userService';
import { activatePendingMembershipsForUser } from '../services/groupService';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

const Home: React.FC<Props> = ({ navigation }) => {
  const db = getFirestore();
  const [modalVisible, setModalVisible] = useState(false);
  const [cardToEdit, setCardToEdit] = useState<Card | null>(null);
  const [cardData, setCardData] = useState<Card[]>([]);
  const [isCardPersonal, setIsCardPersonal] = useState('PRL');
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<'ALL' | 'CREDIT' | 'DEBIT'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [logoutModalVisible, setLogoutModalVisible] = useState(false);
  const [exitModalVisible, setExitModalVisible] = useState(false);
  const [personalLoading, setPersonalLoading] = useState(true);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  const [cardToShare, setCardToShare] = useState<Card | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const { isConnected } = useContext(ConnectivityContext);
  const { groups, loading: groupsLoading } = useUserGroups();
  const { cards: sharedCards, loading: sharedCardsLoading } = useAccessibleCards(groups, isConnected);

  const getCardEffectiveType = (card: Card): string => {
    if (card.cardType) return card.cardType.toUpperCase();
    const detected = detectCardType(card.name);
    if (detected) return detected.toUpperCase();
    if (card.limit && Number(card.limit.replace(/\D/g, '')) > 0) return 'CREDIT';
    return '';
  };

  const groupNameById = useMemo(
    () => groups.reduce<Record<string, string>>((acc, g) => { acc[g.groupId] = g.name; return acc; }, {}),
    [groups],
  );

  const personalCardsWithGroups = useMemo<Card[]>(() => {
    const list = cardData.map((card) => {
      const gnames = (card.sharedGroupIds || []).map(
        (gid) => groupNameById[gid] || 'Group'
      );
      return {
        ...card,
        accessGroupNames: gnames,
      };
    });
    return sortCardsByLatest(list);
  }, [cardData, groupNameById]);

  const sourceCards: Card[] = useMemo(() => {
    const list = isCardPersonal === 'PRL' ? personalCardsWithGroups : sharedCards;
    return sortCardsByLatest(list);
  }, [isCardPersonal, personalCardsWithGroups, sharedCards]);

  const filteredCards = sourceCards.filter((card: Card) => {
    const query = searchQuery.toLowerCase();
    const bankName = BANK_DICTIONARY[card.bankName]?.toLowerCase() || '';
    const networkName = (card.network && (CARD_NETWORKS[card.network] || card.network))?.toLowerCase() || '';
    const cardTypeName = (card.cardType && (CARD_TYPES[card.cardType] || card.cardType))?.toLowerCase() || '';

    return (
      card.ownerName.toLowerCase().includes(query) ||
      bankName.includes(query) ||
      card.number.includes(query) ||
      card.month.includes(query) ||
      card.year.includes(query) ||
      card.cvv.includes(query) ||
      card.name.toLowerCase().includes(query) ||
      card.limit.includes(query) ||
      card.email.toLowerCase().includes(query) ||
      networkName.includes(query) ||
      cardTypeName.includes(query) ||
      (card.network && card.network.toLowerCase().includes(query)) ||
      (card.cardType && card.cardType.toLowerCase().includes(query))
    );
  });

  const showModal = (selectedCard?: Card) => {
    if (!isConnected) {
      Alert.alert('Offline', 'You must be online to add or edit cards.');
      return;
    }
    if (selectedCard && !isEmpty(selectedCard.bankName)) {
      if (auth().currentUser?.email === selectedCard.email) {
        setCardToEdit(selectedCard);
        setModalVisible(true);
      }
    } else {
      setCardToEdit(null);
      setModalVisible(true);
    }
  };

  const hideModal = () => {
    setModalVisible(false);
    setCardToEdit(null);
  };

  useEffect(() => {
    upsertCurrentUserProfile()
      .then(() => activatePendingMembershipsForUser())
      .catch((error: any) => {
        console.error('Failed to refresh user profile / activate memberships', error);
      });
  }, []);



  useEffect(() => {
    // Prevent navigating back to Login screen post login
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (e.data.action.type === 'GO_BACK' || e.data.action.type === 'POP') {
        e.preventDefault();
      }
    });
    return unsubscribe;
  }, [navigation]);

  useFocusEffect(
    React.useCallback(() => {
      // Handle hardware back press only when Home screen is focused
      const onBackPress = () => {
        if (modalVisible) {
          hideModal();
          return true;
        }
        if (cardToShare) {
          setCardToShare(null);
          return true;
        }
        if (selectionMode) {
          setSelectionMode(false);
          setSelectedCardIds([]);
          return true;
        }
        if (logoutModalVisible) {
          setLogoutModalVisible(false);
          return true;
        }
        if (exitModalVisible) {
          setExitModalVisible(false);
          return true;
        }
        // At root Home screen with no modals or selection: show custom exit dialog
        setExitModalVisible(true);
        return true;
      };

      const backHandler = BackHandler.addEventListener(
        'hardwareBackPress',
        onBackPress,
      );

      return () => backHandler.remove();
    }, [modalVisible, cardToShare, selectionMode, logoutModalVisible, exitModalVisible]),
  );

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    try {
      if (isConnected) {
        setPersonalLoading(true);
        console.log("Fetching cards for user:", auth().currentUser?.uid);
        const q = query(collection(db, 'cards'), where('ownerId', '==', auth().currentUser?.uid));
        unsubscribe = onSnapshot(q, (snapshot) => {
          console.log("Snapshot received:", snapshot.size, "documents");
          const cards: Card[] = [];

          snapshot.forEach((snapshotDoc: any) => {
            const card = parseCardDocument(snapshotDoc);
            if (card) {
              cards.push(card);
            }
          });

          console.log("Processed cards:", cards.length);
          setCardData(cards);
          saveCardsInSecureStorage(cards);
          setPersonalLoading(false);
        }, (error) => {
          console.error("Snapshot listener error:", error);
          setPersonalLoading(false);
          fetchCardsFromStorage();
        });
      } else {
        setPersonalLoading(true);
        fetchCardsFromStorage();
      }
    } catch (e) {
      console.error("Error setting up snapshot listeners:", e);
      setPersonalLoading(false);
    }
    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [isConnected]);

  const handleLogoutPress = () => {
    setLogoutModalVisible(true);
  };

  const signOutUser = async () => {
    try {
      await auth().signOut();
      await GoogleSignin.signOut();
      navigation.reset({
        index: 0,
        routes: [{ name: 'Login' }],
      });
      console.log('User signed out from Firebase and Google');
    } catch (error) {
      console.error('Sign-out Error:', error);
    }
  };

  const savingCardRef = useRef(false);

  const handleSaveCard = async (savedCard: Card) => {
    if (savingCardRef.current) return;
    try {
      savingCardRef.current = true;
      console.log('Form submitted successfully!');
      savedCard.email = auth().currentUser?.email || '';
      console.log("Card data before encryption:", savedCard);
      const encryptedData = encryptCardData(savedCard);
      const cardDocData: Record<string, any> = {
        ownerId: auth().currentUser?.uid,
        encryptedData,
        addedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        isPersonal: true,
      };

      console.log("Creating/updating card with data:", cardDocData);

      if (savedCard.key) {
        console.log("Updating existing card:", savedCard.key);
        const { addedAt, createdAt, ...updateData } = cardDocData;
        await updateDoc(doc(db, 'cards', savedCard.key), updateData);
      } else {
        console.log("Creating new card");
        await addDoc(collection(db, 'cards'), {
          ...cardDocData,
          sharedGroupIds: [],
        });
      }

      setIsCardPersonal('PRL');
      hideModal();
    } catch (error) {
      console.error('Error in handleSaveCard:', error);
      Alert.alert('Save Failed', 'Could not save the card. Please try again.');
    } finally {
      savingCardRef.current = false;
    }
  };

  const saveCardsInSecureStorage = async (cards: Card[]) => {
    try {
      const jsonValue = JSON.stringify(cards);
      await EncryptedStorage.setItem('cards', jsonValue);
      console.log('Cards saved successfully');
    } catch (e) {
      console.error('Failed to save cards', e);
    }
  };

  const getCardsFromSecureStorage = async (): Promise<Card[]> => {
    try {
      const jsonValue = await EncryptedStorage.getItem('cards');
      if (jsonValue) {
        try {
          const parsedData: unknown = JSON.parse(jsonValue);
          if (Array.isArray(parsedData)) {
            console.log('Cards retrieved successfully:', parsedData);
            return parsedData as Card[];
          } else {
            console.warn('Data retrieved is not in expected format:', parsedData);
          }
        } catch (parseError) {
          console.error('Error parsing JSON data:', parseError);
        }
      } else {
        console.info('No cards found in secure storage.');
      }
    } catch (e) {
      console.error('Failed to fetch cards from secure storage:', e);
    }
    return [];
  };

  const fetchCardsFromStorage = async () => {
    try {
      const cards = await getCardsFromSecureStorage();
      if (cards && cards.length > 0) {
        setCardData(cards);
      }
    } catch (e) {
      console.error('Failed to load cards from storage', e);
    } finally {
      setPersonalLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      if (isConnected) {
        await Promise.allSettled([
          upsertCurrentUserProfile().then(() => activatePendingMembershipsForUser()),
          (async () => {
            const uid = auth().currentUser?.uid;
            if (uid) {
              const q = query(collection(db, 'cards'), where('ownerId', '==', uid));
              const snap = await getDocs(q);
              const cards: Card[] = [];
              snap.forEach((docSnap: any) => {
                const card = parseCardDocument(docSnap);
                if (card) {
                  cards.push(card);
                }
              });
              setCardData(cards);
              await saveCardsInSecureStorage(cards);
            }
          })(),
        ]);
      } else {
        await fetchCardsFromStorage();
      }
    } catch (e) {
      console.error('Failed to refresh cards:', e);
    } finally {
      setTimeout(() => setRefreshing(false), 300);
    }
  };

  const isCurrentTabLoading = isCardPersonal === 'PRL'
    ? personalLoading
    : (isConnected ? (sharedCardsLoading || groupsLoading) : false);

  const displayedCards = filteredCards.filter((card: Card) => {
      if (selectedTypeFilter === 'ALL') return true;
      const effectiveType = getCardEffectiveType(card);
      return effectiveType === selectedTypeFilter;
    });

  const handleShareCard = (card: Card) => {
    if (!isConnected) {
      Alert.alert('Offline', 'You must be online to share cards.');
      return;
    }
    navigation.navigate('ShareToGroup', { cardIds: [card.key] });
  };

  const handleUnshareCard = (card: Card) => {
    if (!isConnected) {
      Alert.alert('Offline', 'You must be online to unshare cards.');
      return;
    }
    navigation.navigate('UnshareFromGroup', { cardIds: [card.key] });
  };

  const handleUnshareSelected = () => {
    if (!isConnected) {
      Alert.alert('Offline', 'You must be online to unshare cards.');
      return;
    }
    const ids = [...selectedCardIds];
    setSelectionMode(false);
    setSelectedCardIds([]);
    navigation.navigate('UnshareFromGroup', { cardIds: ids });
  };

  const handleShareSelected = () => {
    if (!isConnected) {
      Alert.alert('Offline', 'You must be online to share cards.');
      return;
    }
    const ids = [...selectedCardIds];
    setSelectionMode(false);
    setSelectedCardIds([]);
    navigation.navigate('ShareToGroup', { cardIds: ids });
  };

  const toggleCardSelection = (card: Card) => {
    setSelectedCardIds((prev) => (
      prev.includes(card.key) ? prev.filter((id) => id !== card.key) : [...prev, card.key]
    ));
  };

  const enterSelectionMode = (card?: Card) => {
    setSelectionMode(true);
    if (card?.key) {
      setSelectedCardIds([card.key]);
    }
  };

  return (
    <SafeAreaView style={styles.mainContainer} edges={['top', 'left', 'right']}>
      <View style={{ flex: 1 }}>
        <CardFormModal
          visible={modalVisible}
          onDismiss={hideModal}
          cardToEdit={cardToEdit}
          onSubmit={handleSaveCard}
        />
        <ShareCardModal
          visible={Boolean(cardToShare)}
          card={cardToShare}
          onDismiss={() => setCardToShare(null)}
        />

        <Portal>
          <Dialog
            visible={logoutModalVisible}
            onDismiss={() => setLogoutModalVisible(false)}
            style={styles.confirmDialog}
          >
            <View style={styles.confirmDialogContent}>
              <View style={styles.confirmHeader}>
                <View style={[styles.confirmIconContainer, { backgroundColor: '#FEE2E2' }]}>
                  <Icon source="logout" size={20} color="#DC2626" />
                </View>
                <Text style={styles.confirmDialogTitle}>Log Out</Text>
              </View>
              <Text style={styles.confirmDialogMessage}>
                Are you sure you want to log out of CWallet? You will need to sign in again to access your cards.
              </Text>
              <View style={styles.confirmDialogActions}>
                <TouchableOpacity
                  style={styles.confirmCancelBtn}
                  onPress={() => setLogoutModalVisible(false)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.confirmCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.confirmActionBtn, { backgroundColor: '#DC2626' }]}
                  onPress={() => {
                    setLogoutModalVisible(false);
                    signOutUser();
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.confirmActionText}>Log Out</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Dialog>

          <Dialog
            visible={exitModalVisible}
            onDismiss={() => setExitModalVisible(false)}
            style={styles.confirmDialog}
          >
            <View style={styles.confirmDialogContent}>
              <View style={styles.confirmHeader}>
                <View style={[styles.confirmIconContainer, { backgroundColor: '#F3F4F6' }]}>
                  <Icon source="power" size={20} color="#111111" />
                </View>
                <Text style={styles.confirmDialogTitle}>Exit CWallet</Text>
              </View>
              <Text style={styles.confirmDialogMessage}>
                Are you sure you want to exit the application?
              </Text>
              <View style={styles.confirmDialogActions}>
                <TouchableOpacity
                  style={styles.confirmCancelBtn}
                  onPress={() => setExitModalVisible(false)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.confirmCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.confirmActionBtn, { backgroundColor: '#111111' }]}
                  onPress={() => {
                    setExitModalVisible(false);
                    BackHandler.exitApp();
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.confirmActionText}>Exit App</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Dialog>
        </Portal>

        {/* Top Header Bar */}
        <View style={styles.topBar}>
          {selectionMode ? (
            <>
              <TouchableOpacity
                style={styles.topBarCancelBtn}
                onPress={() => {
                  setSelectionMode(false);
                  setSelectedCardIds([]);
                }}
                activeOpacity={0.7}
              >
                <Icon source="close" size={16} color="#374151" />
                <Text style={styles.topBarCancelText}>Cancel</Text>
              </TouchableOpacity>
              <Text style={styles.topBarSelectionTitle}>
                {selectedCardIds.length} selected
              </Text>
              <TouchableOpacity
                style={styles.topBarSelectAllBtn}
                onPress={() => {
                  if (selectedCardIds.length === cardData.length) {
                    setSelectedCardIds([]);
                  } else {
                    setSelectedCardIds(cardData.map((c) => c.key));
                  }
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.topBarSelectAllText}>
                  {selectedCardIds.length === cardData.length ? 'Clear' : 'Select all'}
                </Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={styles.topBarLeft}>
                <View style={styles.topBarBrandBox}>
                  <Icon source="wallet" size={17} color="#FFFFFF" />
                </View>
                <Text style={styles.topBarBrandTitle}>CWallet</Text>
                <View style={[styles.topBarStatusPill, isConnected ? styles.topBarStatusOnline : styles.topBarStatusOffline]}>
                  <View style={[styles.topBarStatusDot, isConnected ? styles.topBarStatusDotOnline : styles.topBarStatusDotOffline]} />
                  <Text style={[styles.topBarStatusText, isConnected ? styles.topBarStatusTextOnline : styles.topBarStatusTextOffline]}>
                    {isConnected ? 'Online' : 'Offline'}
                  </Text>
                </View>
              </View>
              <View style={styles.topBarRight}>
                <TouchableOpacity
                  style={styles.topBarGroupsBtn}
                  onPress={() => navigation.navigate('Groups')}
                  activeOpacity={0.7}
                >
                  <Icon source="account-group" size={16} color="#111111" />
                  <Text style={styles.topBarGroupsText}>Groups</Text>
                  {groups.length > 0 && (
                    <View style={styles.topBarGroupsBadge}>
                      <Text style={styles.topBarGroupsBadgeText}>{groups.length}</Text>
                    </View>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.topBarLogoutBtn}
                  onPress={handleLogoutPress}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityLabel="Log out"
                >
                  <Icon source="logout" size={16} color="#DC2626" />
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>

        <Searchbar
          placeholder="Search"
          onChangeText={setSearchQuery}
          value={searchQuery}
          style={styles.searchBar}
          inputStyle={styles.searchInput}
          iconColor="white"
          placeholderTextColor="white"
          selectionColor="white"
        />

        {/* Credit / Debit Filter Chips */}
        <View style={styles.filterChipContainer}>
          {isCardPersonal === 'PRL' && (
            <TouchableOpacity
              style={[
                styles.filterChip,
                selectionMode && styles.filterChipActive,
                !isConnected && { opacity: 0.5 },
              ]}
              onPress={() => {
                if (!isConnected) {
                  Alert.alert('Offline', 'You must be online to select cards for sharing or unsharing.');
                  return;
                }
                if (selectionMode) {
                  setSelectionMode(false);
                  setSelectedCardIds([]);
                } else {
                  enterSelectionMode();
                }
              }}
              activeOpacity={0.7}
            >
              <Icon
                source="checkbox-multiple-marked-outline"
                size={13}
                color={selectionMode ? '#FFFFFF' : '#4B5563'}
              />
              <Text
                style={[
                  styles.filterChipText,
                  selectionMode && styles.filterChipTextActive,
                ]}
              >
                Select
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[
              styles.filterChip,
              selectedTypeFilter === 'ALL' && styles.filterChipActive,
            ]}
            onPress={() => setSelectedTypeFilter('ALL')}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.filterChipText,
                selectedTypeFilter === 'ALL' && styles.filterChipTextActive,
              ]}
            >
              All
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.filterChip,
              selectedTypeFilter === 'CREDIT' && styles.filterChipActive,
            ]}
            onPress={() => setSelectedTypeFilter(prev => prev === 'CREDIT' ? 'ALL' : 'CREDIT')}
            activeOpacity={0.7}
          >
            <Icon
              source="credit-card-outline"
              size={13}
              color={selectedTypeFilter === 'CREDIT' ? '#FFFFFF' : '#4B5563'}
            />
            <Text
              style={[
                styles.filterChipText,
                selectedTypeFilter === 'CREDIT' && styles.filterChipTextActive,
              ]}
            >
              Credit
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.filterChip,
              selectedTypeFilter === 'DEBIT' && styles.filterChipActive,
            ]}
            onPress={() => setSelectedTypeFilter(prev => prev === 'DEBIT' ? 'ALL' : 'DEBIT')}
            activeOpacity={0.7}
          >
            <Icon
              source="credit-card-check-outline"
              size={13}
              color={selectedTypeFilter === 'DEBIT' ? '#FFFFFF' : '#4B5563'}
            />
            <Text
              style={[
                styles.filterChipText,
                selectedTypeFilter === 'DEBIT' && styles.filterChipTextActive,
              ]}
            >
              Debit
            </Text>
          </TouchableOpacity>
        </View>

        <FlatList
          data={displayedCards}
          renderItem={({ item }) => (
            <CustomCard
              cardDetails={item}
              onCardLongPress={selectionMode ? toggleCardSelection : (isConnected ? showModal : undefined)}
              onCardEdit={isConnected ? showModal : undefined}
              onShare={isCardPersonal === 'PRL' && isConnected ? handleShareCard : undefined}
              onUnshare={isCardPersonal === 'PRL' && isConnected ? handleUnshareCard : undefined}
              selectionMode={selectionMode && isCardPersonal === 'PRL'}
              isSelected={selectedCardIds.includes(item.key)}
              onToggleSelect={toggleCardSelection}
              showYourCardLabel={isCardPersonal === 'GRP'}
            />
          )}
          keyExtractor={(item, index) => item.key || index.toString()}
          style={{ flex: 1, marginBottom: 0 }}
          contentContainerStyle={{ flexGrow: 1 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              colors={['#111111']}
              tintColor="#111111"
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              {isCurrentTabLoading && sourceCards.length === 0 ? (
                <View style={styles.emptyInner}>
                  <ActivityIndicator size="small" color="#111111" style={{ marginBottom: 12 }} />
                  <Text style={styles.emptyTitle}>
                    {isCardPersonal === 'PRL' ? 'Loading cards...' : 'Loading shared cards...'}
                  </Text>
                  <Text style={styles.emptySubtitle}>
                    Fetching the latest cards for your wallet
                  </Text>
                </View>
              ) : sourceCards.length === 0 ? (
                <View style={styles.emptyInner}>
                  <Icon
                    source={isCardPersonal === 'PRL' ? 'credit-card-plus-outline' : 'account-group-outline'}
                    size={46}
                    color="#9CA3AF"
                  />
                  <Text style={styles.emptyTitle}>
                    {isCardPersonal === 'PRL' ? 'No cards yet' : 'No shared cards yet'}
                  </Text>
                  <Text style={styles.emptySubtitle}>
                    {isCardPersonal === 'PRL'
                      ? 'Add your credit or debit cards to securely manage and share them.'
                      : 'Cards shared with groups you belong to will appear here.'}
                  </Text>
                  {isCardPersonal === 'PRL' && isConnected && (
                    <TouchableOpacity
                      style={styles.emptyActionButton}
                      onPress={() => showModal()}
                      activeOpacity={0.8}
                    >
                      <Icon source="plus" size={16} color="#FFFFFF" />
                      <Text style={styles.emptyActionButtonText}>Add your first card</Text>
                    </TouchableOpacity>
                  )}
                  {isCardPersonal === 'GRP' && (
                    <TouchableOpacity
                      style={styles.emptyActionButton}
                      onPress={() => navigation.navigate('Groups')}
                      activeOpacity={0.8}
                    >
                      <Icon source="account-group" size={16} color="#FFFFFF" />
                      <Text style={styles.emptyActionButtonText}>Manage groups</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ) : (
                <View style={styles.emptyInner}>
                  <Icon
                    source={searchQuery.trim().length > 0 ? 'magnify' : 'credit-card-off-outline'}
                    size={46}
                    color="#9CA3AF"
                  />
                  <Text style={styles.emptyTitle}>
                    {searchQuery.trim().length > 0 ? 'No matching cards' : 'No cards found'}
                  </Text>
                  <Text style={styles.emptySubtitle}>
                    {searchQuery.trim().length > 0
                      ? `No cards matched "${searchQuery.trim()}". Try a different search.`
                      : selectedTypeFilter !== 'ALL'
                      ? `No ${selectedTypeFilter === 'CREDIT' ? 'Credit' : 'Debit'} cards found in ${isCardPersonal === 'PRL' ? 'My Cards' : 'Shared Cards'}.`
                      : 'Try clearing your filters.'}
                  </Text>
                  {(searchQuery.trim().length > 0 || selectedTypeFilter !== 'ALL') && (
                    <TouchableOpacity
                      style={styles.emptyClearButton}
                      onPress={() => {
                        setSearchQuery('');
                        setSelectedTypeFilter('ALL');
                      }}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.emptyClearButtonText}>Clear filters</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
          }
        />

        {selectionMode && isCardPersonal === 'PRL' && (
          <View style={styles.selectionBar}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={styles.selectionCount}>{selectedCardIds.length} selected</Text>
              {cardData.length > 0 && (
                <TouchableOpacity
                  onPress={() => {
                    if (selectedCardIds.length === cardData.length) {
                      setSelectedCardIds([]);
                    } else {
                      setSelectedCardIds(cardData.map((c) => c.key));
                    }
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.selectAllHeaderBtn}>
                    {selectedCardIds.length === cardData.length ? 'Clear' : 'Select all'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity
                style={[styles.unshareSelectedButton, (selectedCardIds.length === 0 || !isConnected) && { opacity: 0.5 }]}
                disabled={selectedCardIds.length === 0 || !isConnected}
                onPress={handleUnshareSelected}
              >
                <Icon source="share-off" size={15} color="#FFFFFF" />
                <Text style={styles.unshareSelectedText}>Unshare</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.shareSelectedButton, (selectedCardIds.length === 0 || !isConnected) && { opacity: 0.5 }]}
                disabled={selectedCardIds.length === 0 || !isConnected}
                onPress={handleShareSelected}
              >
                <Icon source="share-variant" size={15} color="#111111" />
                <Text style={styles.shareSelectedText}>Share</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={styles.bottomTabRow}>
          <TouchableOpacity
            style={[styles.bottomTab, isCardPersonal === 'PRL' && styles.bottomTabActive]}
            onPress={() => {
              setIsCardPersonal('PRL');
              setSelectionMode(false);
              setSelectedCardIds([]);
            }}
            activeOpacity={0.8}
          >
            <Text style={[styles.bottomTabText, isCardPersonal === 'PRL' && styles.bottomTabTextActive]}>
              My Cards
            </Text>
            <View style={[styles.bottomTabBadge, isCardPersonal === 'PRL' ? styles.bottomTabBadgeActive : styles.bottomTabBadgeInactive]}>
              <Text style={[styles.bottomTabBadgeText, isCardPersonal === 'PRL' ? styles.bottomTabBadgeTextActive : styles.bottomTabBadgeTextInactive]}>
                {cardData.length}
              </Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.bottomTab, isCardPersonal === 'GRP' && styles.bottomTabActive]}
            onPress={() => {
              setIsCardPersonal('GRP');
              setSelectionMode(false);
              setSelectedCardIds([]);
            }}
            activeOpacity={0.8}
          >
            <Text style={[styles.bottomTabText, isCardPersonal === 'GRP' && styles.bottomTabTextActive]}>
              Shared Cards
            </Text>
            <View style={[styles.bottomTabBadge, isCardPersonal === 'GRP' ? styles.bottomTabBadgeActive : styles.bottomTabBadgeInactive]}>
              <Text style={[styles.bottomTabBadgeText, isCardPersonal === 'GRP' ? styles.bottomTabBadgeTextActive : styles.bottomTabBadgeTextInactive]}>
                {sharedCards.length}
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        <FAB
          visible={isConnected && !selectionMode}
          icon={isCardPersonal === 'PRL' ? 'plus' : 'account-group'}
          style={styles.fab}
          color="white"
          onPress={() => {
            if (isCardPersonal === 'GRP') {
              navigation.navigate('Groups');
              return;
            }
            showModal();
          }}
        />
      </View>
    </SafeAreaView>
  );
};

export default Home;

const styles = StyleSheet.create({
  mainContainer: {
    backgroundColor: '#F4F5F7',
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
  },
  fab: {
    backgroundColor: '#1B1B1B',
    color: 'white',
    margin: 10,
    borderRadius: 10,
    bottom: 80,
    right: 10,
    position: 'absolute',
  },
  searchBar: {
    marginHorizontal: 12,
    marginTop: 6,
    marginBottom: 8,
    elevation: 2,
    backgroundColor: '#000000',
    borderRadius: 8,
    height: 40,
    justifyContent: 'center',
  },
  searchInput: {
    color: 'white',
    fontSize: 14,
    minHeight: 0,
    paddingVertical: 0,
    alignSelf: 'center',
  },
  filterChipContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
    marginBottom: 6,
    gap: 8,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E5E7EB',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 4,
  },
  filterChipActive: {
    backgroundColor: '#000000',
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4B5563',
  },
  filterChipTextActive: {
    color: '#FFFFFF',
  },
  selectionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 12,
    marginBottom: 4,
    backgroundColor: '#111111',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  selectionCount: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  shareSelectedButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  shareSelectedText: {
    color: '#111111',
    fontWeight: '700',
    fontSize: 13,
  },
  unshareSelectedButton: {
    backgroundColor: '#374151',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  unshareSelectedText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  selectAllHeaderBtn: {
    color: '#9CA3AF',
    fontSize: 12,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  bottomTabRow: {
    flexDirection: 'row',
    marginHorizontal: 12,
    marginVertical: 10,
    backgroundColor: '#E5E7EB',
    borderRadius: 10,
    padding: 4,
  },
  bottomTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderRadius: 8,
    gap: 6,
  },
  bottomTabActive: {
    backgroundColor: '#000000',
  },
  bottomTabText: {
    fontWeight: '700',
    fontSize: 13,
    color: '#4B5563',
  },
  bottomTabTextActive: {
    color: '#FFFFFF',
  },
  bottomTabBadge: {
    paddingHorizontal: 7,
    paddingVertical: 1.5,
    borderRadius: 6,
    minWidth: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomTabBadgeActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
  },
  bottomTabBadgeInactive: {
    backgroundColor: '#D1D5DB',
  },
  bottomTabBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  bottomTabBadgeTextActive: {
    color: '#FFFFFF',
  },
  bottomTabBadgeTextInactive: {
    color: '#374151',
  },
  confirmDialog: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 18,
    paddingHorizontal: 18,
    marginHorizontal: 24,
  },
  confirmDialogContent: {
    padding: 0,
  },
  confirmHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  confirmIconContainer: {
    width: 38,
    height: 38,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmDialogTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111111',
  },
  confirmDialogMessage: {
    fontSize: 14,
    color: '#4B5563',
    lineHeight: 20,
    marginBottom: 20,
  },
  confirmDialogActions: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'flex-end',
  },
  confirmCancelBtn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmCancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
  confirmActionBtn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmActionText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  emptyContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingVertical: 40,
  },
  emptyInner: {
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: 320,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111111',
    marginTop: 14,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 6,
    textAlign: 'center',
    lineHeight: 19,
  },
  emptyActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#111111',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 18,
  },
  emptyActionButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  emptyClearButton: {
    backgroundColor: '#E5E7EB',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    marginTop: 14,
  },
  emptyClearButtonText: {
    color: '#374151',
    fontWeight: '600',
    fontSize: 13,
  },
  topBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  topBarBrandBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarBrandTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111111',
    letterSpacing: -0.4,
  },
  topBarStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  topBarStatusOnline: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  topBarStatusOffline: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  topBarStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  topBarStatusDotOnline: {
    backgroundColor: '#10B981',
  },
  topBarStatusDotOffline: {
    backgroundColor: '#EF4444',
  },
  topBarStatusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  topBarStatusTextOnline: {
    color: '#047857',
  },
  topBarStatusTextOffline: {
    color: '#B91C1C',
  },
  topBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  topBarGroupsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  topBarGroupsText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#111111',
  },
  topBarGroupsBadge: {
    backgroundColor: '#111111',
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 1,
    minWidth: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarGroupsBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  topBarLogoutBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FECACA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarCancelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  topBarCancelText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#374151',
  },
  topBarSelectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111111',
  },
  topBarSelectAllBtn: {
    backgroundColor: '#111111',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarSelectAllText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
