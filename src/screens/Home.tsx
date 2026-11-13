import { View, SafeAreaView, StyleSheet, TouchableOpacity, FlatList, BackHandler, Alert } from 'react-native';
import React, { useContext, useEffect, useMemo, useState } from 'react';
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
import { getFirestore, collection, doc, addDoc, updateDoc, query, where, onSnapshot, serverTimestamp } from '@react-native-firebase/firestore';
import { encryptCardData } from '../util/Crypto';
import { ConnectivityContext } from '../util/Connectivity';
import { detectCardType } from '../util/Utils';
import EncryptedStorage from 'react-native-encrypted-storage';
import { parseCardDocument } from '../services/cardService';
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
  const [loadingScreen, setLoadingScreen] = useState('Loading cards');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  const [cardToShare, setCardToShare] = useState<Card | null>(null);
  const { isConnected } = useContext(ConnectivityContext);
  const { groups } = useUserGroups();
  const { cards: sharedCards } = useAccessibleCards(groups, isConnected);

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
    return cardData.map((card) => ({
      ...card,
      accessGroupNames: (card.sharedGroupIds || [])
        .map((gid) => groupNameById[gid])
        .filter(Boolean),
    }));
  }, [cardData, groupNameById]);

  const sourceCards: Card[] = isCardPersonal === 'PRL' ? personalCardsWithGroups : sharedCards;

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
    navigation.setOptions({
      headerRight: () => (
        selectionMode ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <TouchableOpacity onPress={() => {
              setSelectionMode(false);
              setSelectedCardIds([]);
            }}>
              <Text style={{ color: 'black' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <TouchableOpacity onPress={() => navigation.navigate('Groups')}>
              <Text style={{ color: 'black' }}>Groups</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleLogoutPress}>
              <Text style={{ color: 'black' }}>Logout</Text>
            </TouchableOpacity>
          </View>
        )
      ),
      title: selectionMode ? `${selectedCardIds.length} selected` : undefined,
    });
  }, [navigation, selectionMode, selectedCardIds.length]);

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
    try {
      if (isConnected) {
        console.log("Fetching cards for user:", auth().currentUser?.uid);
        const q = query(collection(db, 'cards'), where('ownerId', '==', auth().currentUser?.uid));
        const unsubscribe = onSnapshot(q, (snapshot) => {
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
        }, (error) => {
          console.error("Snapshot listener error:", error);
        });

        return () => {
          unsubscribe();
        };
      } else {
        fetchCardsFromStorage();
      }
    } catch (e) {
      console.error("Error setting up snapshot listeners:", e);
    }
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

  const handleSaveCard = async (savedCard: Card) => {
    try {
      console.log('Form submitted successfully!');
      savedCard.email = auth().currentUser?.email || '';
      console.log("Card data before encryption:", savedCard);
      const encryptedData = encryptCardData(savedCard);
      const cardDocData: Record<string, any> = {
        ownerId: auth().currentUser?.uid,
        encryptedData,
        addedAt: serverTimestamp(),
        isPersonal: true,
      };

      console.log("Creating/updating card with data:", cardDocData);

      if (savedCard.key) {
        console.log("Updating existing card:", savedCard.key);
        const { addedAt, ...updateData } = cardDocData;
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
      setLoadingScreen("Error saving card.");
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
    } finally {
      setLoadingScreen("No cards found.");
    }
    return [];
  };

  const fetchCardsFromStorage = async () => {
    const cards = await getCardsFromSecureStorage();
    if (cards.length > 0) {
      setCardData(cards);
    }
  };

  const displayedCards = filteredCards.filter((card: Card) => {
      if (selectedTypeFilter === 'ALL') return true;
      const effectiveType = getCardEffectiveType(card);
      return effectiveType === selectedTypeFilter;
    });

  const handleShareCard = (card: Card) => {
    navigation.navigate('ShareToGroup', { cardIds: [card.key] });
  };

  const handleUnshareCard = (card: Card) => {
    navigation.navigate('UnshareFromGroup', { cardIds: [card.key] });
  };

  const handleUnshareSelected = () => {
    const ids = [...selectedCardIds];
    setSelectionMode(false);
    setSelectedCardIds([]);
    navigation.navigate('UnshareFromGroup', { cardIds: ids });
  };

  const handleShareSelected = () => {
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
    <SafeAreaView style={styles.mainContainer}>
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
              style={[styles.filterChip, selectionMode && styles.filterChipActive]}
              onPress={() => {
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
              onCardLongPress={selectionMode ? toggleCardSelection : showModal}
              onCardEdit={showModal}
              onShare={isCardPersonal === 'PRL' ? handleShareCard : undefined}
              onUnshare={isCardPersonal === 'PRL' ? handleUnshareCard : undefined}
              selectionMode={selectionMode && isCardPersonal === 'PRL'}
              isSelected={selectedCardIds.includes(item.key)}
              onToggleSelect={toggleCardSelection}
              showYourCardLabel={isCardPersonal === 'GRP'}
            />
          )}
          keyExtractor={(item, index) => item.key || index.toString()}
          style={{ flex: 1, marginBottom: 0 }}
          contentContainerStyle={{ flexGrow: 1 }}
          ListEmptyComponent={
            <View style={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20 }}>
              <Icon source="credit-card-off-outline" size={44} color="#9CA3AF" />
              <Text style={{ fontSize: 16, color: '#6B7280', marginTop: 10, textAlign: 'center' }}>
                {sourceCards.length === 0
                  ? (isCardPersonal === 'GRP' ? 'No cards shared with your groups yet.' : loadingScreen)
                  : selectedTypeFilter !== 'ALL'
                  ? `No ${selectedTypeFilter === 'CREDIT' ? 'Credit' : 'Debit'} cards found in ${isCardPersonal === 'PRL' ? 'My Cards' : 'Shared Cards'}`
                  : `No cards found in ${isCardPersonal === 'PRL' ? 'My Cards' : 'Shared Cards'}`}
              </Text>
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
                style={[styles.unshareSelectedButton, selectedCardIds.length === 0 && { opacity: 0.5 }]}
                disabled={selectedCardIds.length === 0}
                onPress={handleUnshareSelected}
              >
                <Icon source="share-off" size={15} color="#FFFFFF" />
                <Text style={styles.unshareSelectedText}>Unshare</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.shareSelectedButton, selectedCardIds.length === 0 && { opacity: 0.5 }]}
                disabled={selectedCardIds.length === 0}
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
    marginHorizontal: 10,
    marginTop: 10,
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
    marginHorizontal: 10,
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
    marginHorizontal: 10,
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
});
