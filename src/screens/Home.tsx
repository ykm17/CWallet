import { View, StyleSheet, TouchableOpacity, FlatList, BackHandler, ActivityIndicator, RefreshControl, Image, TextInput, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import React, { useContext, useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { Alert } from '../components/CustomAlert';
import CustomCard from '../components/CustomCard';
import CardFormModal from '../components/CardFormModal';
import ShareCardModal from '../components/ShareCardModal';
import BankLogo from '../components/BankLogo';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../App';
import auth from '@react-native-firebase/auth';
import { Card } from '../types/Types';
import { FAB, Text, SegmentedButtons, Searchbar, Icon, Dialog, Portal, Modal } from 'react-native-paper';
import { isEmpty } from 'lodash';
import { APP_NAME, BANK_DICTIONARY, CARD_NETWORKS, CARD_TYPES } from '../constants/Constants';
import { getFirestore, collection, doc, addDoc, updateDoc, query, where, onSnapshot, serverTimestamp, getDocs } from '@react-native-firebase/firestore';
import { encryptCardData } from '../util/Crypto';
import { ConnectivityContext } from '../util/Connectivity';
import { usePrivacy } from '../util/PrivacyContext';
import { detectCardType, detectCardNetwork } from '../util/Utils';
import EncryptedStorage from 'react-native-encrypted-storage';
import { parseCardDocument } from '../services/cardService';
import { sortCardsByLatest } from '../services/sharingUtils';
import { activatePendingCardAccessForUser } from '../services/sharingService';
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
  const [selectedBankFilter, setSelectedBankFilter] = useState<string | null>(null);
  const [selectedNetworkFilter, setSelectedNetworkFilter] = useState<string | null>(null);
  const [selectedNameFilter, setSelectedNameFilter] = useState<string | null>(null);
  const [bankFilterModalVisible, setBankFilterModalVisible] = useState(false);
  const [networkFilterModalVisible, setNetworkFilterModalVisible] = useState(false);
  const [nameFilterModalVisible, setNameFilterModalVisible] = useState(false);
  const [bankFilterSearch, setBankFilterSearch] = useState('');
  const [networkFilterSearch, setNetworkFilterSearch] = useState('');
  const [nameFilterSearch, setNameFilterSearch] = useState('');
  const [isSavingCard, setIsSavingCard] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [logoutModalVisible, setLogoutModalVisible] = useState(false);
  const [exitModalVisible, setExitModalVisible] = useState(false);
  const [personalLoading, setPersonalLoading] = useState(true);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  const [cardToShare, setCardToShare] = useState<Card | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const { isConnected } = useContext(ConnectivityContext);
  const { isPrivacyMode, togglePrivacyMode } = usePrivacy();
  const { groups, loading: groupsLoading } = useUserGroups();
  const { cards: sharedCards, loading: sharedCardsLoading, refetchOfflineCards: refetchOfflineSharedCards } = useAccessibleCards(groups, isConnected, groupsLoading);

  const currentUser = auth().currentUser;
  const displayName = currentUser?.displayName || 'CWallet User';
  const email = currentUser?.email || '';
  const photoUrl = currentUser?.photoURL;
  const initial = (displayName.charAt(0) || email.charAt(0) || 'U').toUpperCase();

  const getCardEffectiveType = (card: Card): string => {
    if (card.cardType) return card.cardType.toUpperCase();
    if (card.bankName === 'PX') return 'PREPAID';
    const detected = detectCardType(card.name);
    if (detected) return detected.toUpperCase();
    if (card.limit && Number(card.limit.replace(/\D/g, '')) > 0) return 'CREDIT';
    return '';
  };

  const getCardEffectiveNetwork = (card: Card): string => {
    if (card.network) return card.network.toUpperCase();
    const detected = detectCardNetwork(card.number, card.name);
    if (detected) return detected.toUpperCase();
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

  const isCardShared = useCallback((card: Card): boolean => {
    const hasGroups = Array.isArray(card.sharedGroupIds) && card.sharedGroupIds.filter((gid) => gid && typeof gid === 'string' && gid.trim().length > 0).length > 0;
    const hasUsers = Array.isArray(card.sharedWithUsers) && card.sharedWithUsers.filter((u) => u && (u.email || u.recipientUid || u.appleUserId)).length > 0;
    const hasEmails = Array.isArray(card.sharedEmails) && card.sharedEmails.filter((e) => e && typeof e === 'string' && e.trim().length > 0).length > 0;
    const hasUserIds = Array.isArray(card.sharedUserIds) && card.sharedUserIds.filter((id) => id && typeof id === 'string' && id.trim().length > 0).length > 0;
    return Boolean(hasGroups || hasUsers || hasEmails || hasUserIds);
  }, []);

  const allSharedCards = useMemo<Card[]>(() => {
    const combined = new Map<string, Card>();

    // 1. Cards shared WITH the current user by others
    sharedCards.forEach((c) => {
      combined.set(c.key, c);
    });

    // 2. Cards owned by current user that have been shared (to a friend directly, or to a group, or both)
    personalCardsWithGroups.forEach((card) => {
      if (isCardShared(card)) {
        combined.set(card.key, card);
      }
    });

    return sortCardsByLatest(Array.from(combined.values()));
  }, [sharedCards, personalCardsWithGroups, isCardShared]);

  const sourceCards: Card[] = useMemo(() => {
    const list = isCardPersonal === 'PRL' ? personalCardsWithGroups : allSharedCards;
    return sortCardsByLatest(list);
  }, [isCardPersonal, personalCardsWithGroups, allSharedCards]);

  const creditCardsCount = useMemo(() => {
    return sourceCards.filter((card) => getCardEffectiveType(card) === 'CREDIT').length;
  }, [sourceCards]);

  const debitCardsCount = useMemo(() => {
    return sourceCards.filter((card) => getCardEffectiveType(card) === 'DEBIT').length;
  }, [sourceCards]);

  const availableBanks = useMemo(() => {
    const bankSet = new Set<string>();
    sourceCards.forEach((c) => {
      if (c.bankName) {
        bankSet.add(c.bankName);
      }
    });
    return Array.from(bankSet).sort((a, b) => {
      const nameA = BANK_DICTIONARY[a] || a;
      const nameB = BANK_DICTIONARY[b] || b;
      return nameA.localeCompare(nameB);
    });
  }, [sourceCards]);

  const availableNames = useMemo(() => {
    const nameSet = new Set<string>();
    sourceCards.forEach((c) => {
      const trimmed = c.ownerName ? c.ownerName.trim() : '';
      if (trimmed) {
        nameSet.add(trimmed);
      }
    });
    return Array.from(nameSet).sort((a, b) => a.localeCompare(b));
  }, [sourceCards]);

  const availableNetworks = useMemo(() => {
    const netSet = new Set<string>();
    sourceCards.forEach((c) => {
      const net = getCardEffectiveNetwork(c);
      if (net) {
        netSet.add(net);
      }
    });
    return Array.from(netSet).sort((a, b) => {
      const nameA = CARD_NETWORKS[a] || a;
      const nameB = CARD_NETWORKS[b] || b;
      return nameA.localeCompare(nameB);
    });
  }, [sourceCards]);

  const bankCardCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    sourceCards.forEach((c) => {
      if (c.bankName) {
        counts[c.bankName] = (counts[c.bankName] || 0) + 1;
      }
    });
    return counts;
  }, [sourceCards]);

  const networkCardCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    sourceCards.forEach((c) => {
      const net = getCardEffectiveNetwork(c);
      if (net) {
        counts[net] = (counts[net] || 0) + 1;
      }
    });
    return counts;
  }, [sourceCards]);

  const nameCardCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    sourceCards.forEach((c) => {
      const trimmed = c.ownerName ? c.ownerName.trim() : '';
      if (trimmed) {
        counts[trimmed] = (counts[trimmed] || 0) + 1;
      }
    });
    return counts;
  }, [sourceCards]);

  const filteredAvailableBanks = useMemo(() => {
    const q = bankFilterSearch.trim().toLowerCase();
    if (!q) return availableBanks;
    return availableBanks.filter((bankKey) => {
      const fullName = (BANK_DICTIONARY[bankKey] || bankKey).toLowerCase();
      return fullName.includes(q) || bankKey.toLowerCase().includes(q);
    });
  }, [availableBanks, bankFilterSearch]);

  const filteredAvailableNetworks = useMemo(() => {
    const q = networkFilterSearch.trim().toLowerCase();
    if (!q) return availableNetworks;
    return availableNetworks.filter((netKey) => {
      const fullName = (CARD_NETWORKS[netKey] || netKey).toLowerCase();
      return fullName.includes(q) || netKey.toLowerCase().includes(q);
    });
  }, [availableNetworks, networkFilterSearch]);

  const filteredAvailableNames = useMemo(() => {
    const q = nameFilterSearch.trim().toLowerCase();
    if (!q) return availableNames;
    return availableNames.filter((name) => name.toLowerCase().includes(q));
  }, [availableNames, nameFilterSearch]);

  const filteredCards = sourceCards.filter((card: Card) => {
    const query = searchQuery.toLowerCase();
    const bankName = BANK_DICTIONARY[card.bankName]?.toLowerCase() || '';
    const networkName = (card.network && (CARD_NETWORKS[card.network] || card.network))?.toLowerCase() || '';
    const cardTypeName = (card.cardType && (CARD_TYPES[card.cardType] || card.cardType))?.toLowerCase() || '';

    return (
      card.ownerName.toLowerCase().includes(query) ||
      bankName.includes(query) ||
      (card.bankName === 'PX' && 'sodexo'.includes(query)) ||
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
    if (savingCardRef.current || isSavingCard) {
      console.log('Cannot dismiss card modal while database update is in progress');
      return;
    }
    setModalVisible(false);
    setCardToEdit(null);
  };

  useEffect(() => {
    upsertCurrentUserProfile()
      .then(() => Promise.allSettled([activatePendingMembershipsForUser(), activatePendingCardAccessForUser()]))
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
          if (savingCardRef.current || isSavingCard) {
            // Do not allow closing when adding or updating card in database
            return true;
          }
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
        if (bankFilterModalVisible) {
          setBankFilterModalVisible(false);
          return true;
        }
        if (networkFilterModalVisible) {
          setNetworkFilterModalVisible(false);
          return true;
        }
        if (nameFilterModalVisible) {
          setNameFilterModalVisible(false);
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
    }, [modalVisible, isSavingCard, cardToShare, selectionMode, logoutModalVisible, exitModalVisible, bankFilterModalVisible, networkFilterModalVisible, nameFilterModalVisible]),
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
      await Promise.allSettled([
        EncryptedStorage.removeItem('cwallet_auth_user'),
        EncryptedStorage.removeItem('cards'),
        EncryptedStorage.removeItem('shared_cards'),
      ]);
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
    if (savingCardRef.current || isSavingCard) return;
    try {
      savingCardRef.current = true;
      setIsSavingCard(true);
      console.log('Form submitted successfully!');
      savedCard.email = auth().currentUser?.email || '';
      savedCard.updatedAt = Date.now();
      if (!savedCard.createdAt && !savedCard.addedAt) {
        savedCard.createdAt = Date.now();
        savedCard.addedAt = Date.now();
      }
      console.log("Card data before encryption:", savedCard);
      const encryptedData = encryptCardData(savedCard);
      const nowTs = serverTimestamp();

      if (savedCard.key) {
        console.log("Updating existing card:", savedCard.key);
        await updateDoc(doc(db, 'cards', savedCard.key), {
          encryptedData,
          updatedAt: nowTs,
          billGenerationDate: savedCard.billGenerationDate || '',
        });
      } else {
        console.log("Creating new card");
        await addDoc(collection(db, 'cards'), {
          ownerId: auth().currentUser?.uid,
          encryptedData,
          addedAt: nowTs,
          createdAt: nowTs,
          updatedAt: nowTs,
          isPersonal: true,
          sharedGroupIds: [],
          billGenerationDate: savedCard.billGenerationDate || '',
        });
      }

      setIsCardPersonal('PRL');
      // DB operation finished - allow closing now
      savingCardRef.current = false;
      setIsSavingCard(false);
      hideModal();
    } catch (error) {
      console.error('Error in handleSaveCard:', error);
      savingCardRef.current = false;
      setIsSavingCard(false);
      Alert.alert('Save Failed', 'Could not save the card. Please try again.');
    } finally {
      savingCardRef.current = false;
      setIsSavingCard(false);
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
      if (Array.isArray(cards)) {
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
          upsertCurrentUserProfile().then(() => Promise.allSettled([activatePendingMembershipsForUser(), activatePendingCardAccessForUser()])),
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
        await Promise.allSettled([
          fetchCardsFromStorage(),
          refetchOfflineSharedCards?.(),
        ]);
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
    if (selectedTypeFilter !== 'ALL') {
      const effectiveType = getCardEffectiveType(card);
      if (effectiveType !== selectedTypeFilter) return false;
    }
    if (selectedBankFilter && card.bankName !== selectedBankFilter) {
      return false;
    }
    if (selectedNetworkFilter) {
      const effectiveNet = getCardEffectiveNetwork(card);
      if (effectiveNet !== selectedNetworkFilter) return false;
    }
    if (
      selectedNameFilter &&
      (card.ownerName || '').trim().toLowerCase() !== selectedNameFilter.trim().toLowerCase()
    ) {
      return false;
    }
    return true;
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
                Are you sure you want to log out of {APP_NAME}? You will need to sign in again to access your cards.
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
                <Text style={styles.confirmDialogTitle}>Exit {APP_NAME}</Text>
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

          {/* Bank Filter Modal */}
          <Modal
            visible={bankFilterModalVisible}
            onDismiss={() => setBankFilterModalVisible(false)}
            contentContainerStyle={styles.filterModalContainer}
          >
            <View style={styles.filterModalHeader}>
              <View style={styles.filterModalHeaderLeft}>
                <View style={styles.filterModalIconWrap}>
                  <Icon source="bank" size={18} color="#111111" />
                </View>
                <Text style={styles.filterModalTitle}>Filter by Bank</Text>
              </View>
              <TouchableOpacity
                onPress={() => setBankFilterModalVisible(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Icon source="close" size={20} color="#6B7280" />
              </TouchableOpacity>
            </View>

            {availableBanks.length > 5 && (
              <View style={styles.filterModalSearchContainer}>
                <Icon source="magnify" size={16} color="#9CA3AF" />
                <TextInput
                  placeholder="Search bank name..."
                  placeholderTextColor="#9CA3AF"
                  value={bankFilterSearch}
                  onChangeText={setBankFilterSearch}
                  style={styles.filterModalSearchInput}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {bankFilterSearch.length > 0 && (
                  <TouchableOpacity
                    onPress={() => setBankFilterSearch('')}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Icon source="close-circle" size={14} color="#9CA3AF" />
                  </TouchableOpacity>
                )}
              </View>
            )}

            <FlatList
              data={filteredAvailableBanks}
              keyExtractor={(item) => item}
              style={styles.filterModalList}
              contentContainerStyle={styles.filterModalListContent}
              keyboardShouldPersistTaps="handled"
              ListHeaderComponent={
                !bankFilterSearch ? (
                  <TouchableOpacity
                    style={[
                      styles.filterModalItemRow,
                      selectedBankFilter === null && styles.filterModalItemRowSelected,
                    ]}
                    onPress={() => {
                      setSelectedBankFilter(null);
                      setBankFilterModalVisible(false);
                    }}
                    activeOpacity={0.7}
                  >
                    <View style={styles.filterModalAllIcon}>
                      <Icon source="bank-outline" size={18} color="#4B5563" />
                    </View>
                    <View style={styles.filterModalItemTextWrap}>
                      <Text style={[
                        styles.filterModalItemTitle,
                        selectedBankFilter === null && styles.filterModalItemTitleSelected,
                      ]}>
                        All Banks
                      </Text>
                      <Text style={styles.filterModalItemSub}>
                        Show cards from all banks ({sourceCards.length})
                      </Text>
                    </View>
                    {selectedBankFilter === null && (
                      <Icon source="check-circle" size={20} color="#111111" />
                    )}
                  </TouchableOpacity>
                ) : null
              }
              renderItem={({ item }) => {
                const isSelected = selectedBankFilter === item;
                const bankName = BANK_DICTIONARY[item] || item;
                const count = bankCardCounts[item] || 0;
                return (
                  <TouchableOpacity
                    style={[
                      styles.filterModalItemRow,
                      isSelected && styles.filterModalItemRowSelected,
                    ]}
                    onPress={() => {
                      setSelectedBankFilter(item);
                      setBankFilterModalVisible(false);
                    }}
                    activeOpacity={0.7}
                  >
                    <BankLogo bankKey={item} size={28} style={styles.filterModalBankLogo} />
                    <View style={styles.filterModalItemTextWrap}>
                      <Text style={[
                        styles.filterModalItemTitle,
                        isSelected && styles.filterModalItemTitleSelected,
                      ]}>
                        {bankName}
                      </Text>
                      <Text style={styles.filterModalItemSub}>
                        {count} {count === 1 ? 'card' : 'cards'}
                      </Text>
                    </View>
                    {isSelected && (
                      <Icon source="check-circle" size={20} color="#111111" />
                    )}
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <View style={styles.filterModalEmpty}>
                  <Text style={styles.filterModalEmptyText}>
                    {availableBanks.length === 0
                      ? 'No cards available to filter'
                      : `No bank matching "${bankFilterSearch}"`}
                  </Text>
                </View>
              }
            />
          </Modal>

          {/* Network Filter Modal */}
          <Modal
            visible={networkFilterModalVisible}
            onDismiss={() => setNetworkFilterModalVisible(false)}
            contentContainerStyle={styles.filterModalContainer}
          >
            <View style={styles.filterModalHeader}>
              <View style={styles.filterModalHeaderLeft}>
                <View style={styles.filterModalIconWrap}>
                  <Icon source="credit-card-chip-outline" size={18} color="#111111" />
                </View>
                <Text style={styles.filterModalTitle}>Filter by Network</Text>
              </View>
              <TouchableOpacity
                onPress={() => setNetworkFilterModalVisible(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Icon source="close" size={20} color="#6B7280" />
              </TouchableOpacity>
            </View>

            {availableNetworks.length > 5 && (
              <View style={styles.filterModalSearchContainer}>
                <Icon source="magnify" size={16} color="#9CA3AF" />
                <TextInput
                  placeholder="Search network name..."
                  placeholderTextColor="#9CA3AF"
                  value={networkFilterSearch}
                  onChangeText={setNetworkFilterSearch}
                  style={styles.filterModalSearchInput}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {networkFilterSearch.length > 0 && (
                  <TouchableOpacity
                    onPress={() => setNetworkFilterSearch('')}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Icon source="close-circle" size={14} color="#9CA3AF" />
                  </TouchableOpacity>
                )}
              </View>
            )}

            <FlatList
              data={filteredAvailableNetworks}
              keyExtractor={(item) => item}
              style={styles.filterModalList}
              contentContainerStyle={styles.filterModalListContent}
              keyboardShouldPersistTaps="handled"
              ListHeaderComponent={
                !networkFilterSearch ? (
                  <TouchableOpacity
                    style={[
                      styles.filterModalItemRow,
                      selectedNetworkFilter === null && styles.filterModalItemRowSelected,
                    ]}
                    onPress={() => {
                      setSelectedNetworkFilter(null);
                      setNetworkFilterModalVisible(false);
                    }}
                    activeOpacity={0.7}
                  >
                    <View style={styles.filterModalAllIcon}>
                      <Icon source="credit-card-outline" size={18} color="#4B5563" />
                    </View>
                    <View style={styles.filterModalItemTextWrap}>
                      <Text style={[
                        styles.filterModalItemTitle,
                        selectedNetworkFilter === null && styles.filterModalItemTitleSelected,
                      ]}>
                        All Networks
                      </Text>
                      <Text style={styles.filterModalItemSub}>
                        Show cards from all payment networks ({sourceCards.length})
                      </Text>
                    </View>
                    {selectedNetworkFilter === null && (
                      <Icon source="check-circle" size={20} color="#111111" />
                    )}
                  </TouchableOpacity>
                ) : null
              }
              renderItem={({ item }) => {
                const isSelected = selectedNetworkFilter === item;
                const netName = CARD_NETWORKS[item] || item;
                const count = networkCardCounts[item] || 0;
                return (
                  <TouchableOpacity
                    style={[
                      styles.filterModalItemRow,
                      isSelected && styles.filterModalItemRowSelected,
                    ]}
                    onPress={() => {
                      setSelectedNetworkFilter(item);
                      setNetworkFilterModalVisible(false);
                    }}
                    activeOpacity={0.7}
                  >
                    <View style={styles.filterModalNetworkBadge}>
                      <Text style={styles.filterModalNetworkBadgeText} numberOfLines={1}>
                        {item.length <= 5 ? item : item.slice(0, 4)}
                      </Text>
                    </View>
                    <View style={styles.filterModalItemTextWrap}>
                      <Text style={[
                        styles.filterModalItemTitle,
                        isSelected && styles.filterModalItemTitleSelected,
                      ]}>
                        {netName}
                      </Text>
                      <Text style={styles.filterModalItemSub}>
                        {count} {count === 1 ? 'card' : 'cards'}
                      </Text>
                    </View>
                    {isSelected && (
                      <Icon source="check-circle" size={20} color="#111111" />
                    )}
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <View style={styles.filterModalEmpty}>
                  <Text style={styles.filterModalEmptyText}>
                    {availableNetworks.length === 0
                      ? 'No networks available to filter'
                      : `No network matching "${networkFilterSearch}"`}
                  </Text>
                </View>
              }
            />
          </Modal>

          {/* Name Filter Modal */}
          <Modal
            visible={nameFilterModalVisible}
            onDismiss={() => setNameFilterModalVisible(false)}
            contentContainerStyle={styles.filterModalContainer}
          >
            <View style={styles.filterModalHeader}>
              <View style={styles.filterModalHeaderLeft}>
                <View style={styles.filterModalIconWrap}>
                  <Icon source="account" size={18} color="#111111" />
                </View>
                <Text style={styles.filterModalTitle}>Filter by Cardholder</Text>
              </View>
              <TouchableOpacity
                onPress={() => setNameFilterModalVisible(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Icon source="close" size={20} color="#6B7280" />
              </TouchableOpacity>
            </View>

            {availableNames.length > 5 && (
              <View style={styles.filterModalSearchContainer}>
                <Icon source="magnify" size={16} color="#9CA3AF" />
                <TextInput
                  placeholder="Search cardholder name..."
                  placeholderTextColor="#9CA3AF"
                  value={nameFilterSearch}
                  onChangeText={setNameFilterSearch}
                  style={styles.filterModalSearchInput}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {nameFilterSearch.length > 0 && (
                  <TouchableOpacity
                    onPress={() => setNameFilterSearch('')}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Icon source="close-circle" size={14} color="#9CA3AF" />
                  </TouchableOpacity>
                )}
              </View>
            )}

            <FlatList
              data={filteredAvailableNames}
              keyExtractor={(item) => item}
              style={styles.filterModalList}
              contentContainerStyle={styles.filterModalListContent}
              keyboardShouldPersistTaps="handled"
              ListHeaderComponent={
                !nameFilterSearch ? (
                  <TouchableOpacity
                    style={[
                      styles.filterModalItemRow,
                      selectedNameFilter === null && styles.filterModalItemRowSelected,
                    ]}
                    onPress={() => {
                      setSelectedNameFilter(null);
                      setNameFilterModalVisible(false);
                    }}
                    activeOpacity={0.7}
                  >
                    <View style={styles.filterModalAllIcon}>
                      <Icon source="account-multiple-outline" size={18} color="#4B5563" />
                    </View>
                    <View style={styles.filterModalItemTextWrap}>
                      <Text style={[
                        styles.filterModalItemTitle,
                        selectedNameFilter === null && styles.filterModalItemTitleSelected,
                      ]}>
                        All Cardholders
                      </Text>
                      <Text style={styles.filterModalItemSub}>
                        Show cards from all cardholders ({sourceCards.length})
                      </Text>
                    </View>
                    {selectedNameFilter === null && (
                      <Icon source="check-circle" size={20} color="#111111" />
                    )}
                  </TouchableOpacity>
                ) : null
              }
              renderItem={({ item }) => {
                const isSelected = selectedNameFilter?.trim().toLowerCase() === item.trim().toLowerCase();
                const count = nameCardCounts[item] || 0;
                const initialChar = (item.charAt(0) || 'U').toUpperCase();
                return (
                  <TouchableOpacity
                    style={[
                      styles.filterModalItemRow,
                      isSelected && styles.filterModalItemRowSelected,
                    ]}
                    onPress={() => {
                      setSelectedNameFilter(item);
                      setNameFilterModalVisible(false);
                    }}
                    activeOpacity={0.7}
                  >
                    <View style={styles.filterModalNameAvatar}>
                      <Text style={styles.filterModalNameAvatarText}>{initialChar}</Text>
                    </View>
                    <View style={styles.filterModalItemTextWrap}>
                      <Text style={[
                        styles.filterModalItemTitle,
                        isSelected && styles.filterModalItemTitleSelected,
                      ]}>
                        {item}
                      </Text>
                      <Text style={styles.filterModalItemSub}>
                        {count} {count === 1 ? 'card' : 'cards'}
                      </Text>
                    </View>
                    {isSelected && (
                      <Icon source="check-circle" size={20} color="#111111" />
                    )}
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <View style={styles.filterModalEmpty}>
                  <Text style={styles.filterModalEmptyText}>
                    {availableNames.length === 0
                      ? 'No cardholders available to filter'
                      : `No cardholder matching "${nameFilterSearch}"`}
                  </Text>
                </View>
              }
            />
          </Modal>
        </Portal>

        {/* Top Header Bar */}
        <View style={styles.topBar}>
          {selectionMode ? (
            <View style={styles.selectionTopBar}>
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
              <View style={styles.selectionTitleContainer}>
                <Text style={styles.topBarSelectionTitle}>
                  {selectedCardIds.length} selected
                </Text>
              </View>
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
            </View>
          ) : (
            <>
              <View style={styles.topBarLeft}>
                <TouchableOpacity
                  onPress={() => navigation.navigate('Profile')}
                  activeOpacity={0.7}
                  accessibilityLabel="Open profile"
                >
                  <View style={styles.avatarWrap}>
                    {photoUrl ? (
                      <Image source={{ uri: photoUrl }} style={styles.avatarImage} />
                    ) : (
                      <View style={styles.avatarPlaceholder}>
                        <Text style={styles.avatarInitial}>{initial}</Text>
                      </View>
                    )}
                    <View style={[styles.avatarStatusDot, isConnected ? styles.dotOnline : styles.dotOffline]} />
                  </View>
                </TouchableOpacity>

                <View style={styles.userInfoWrap}>
                  <TouchableOpacity
                    onPress={() => navigation.navigate('Profile')}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.appTitleText}>{APP_NAME}</Text>
                  </TouchableOpacity>

                  <View style={styles.userNameRow}>
                    <TouchableOpacity
                      onPress={() => navigation.navigate('Profile')}
                      activeOpacity={0.7}
                      style={{ flexShrink: 1 }}
                    >
                      <Text style={styles.userNameText} numberOfLines={1}>
                        {displayName}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.privacyToggleBtn}
                      onPress={togglePrivacyMode}
                      hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
                      activeOpacity={0.6}
                      accessibilityLabel={isPrivacyMode ? 'Disable privacy mode' : 'Enable privacy mode'}
                    >
                      <Icon
                        source={isPrivacyMode ? 'eye-off' : 'eye'}
                        size={17}
                        color={isPrivacyMode ? '#2563EB' : '#71717A'}
                      />
                    </TouchableOpacity>
                  </View>
                </View>
              </View>

              <View style={styles.topBarRight}>
                <View style={[styles.statusBadge, isConnected ? styles.statusBadgeOnline : styles.statusBadgeOffline]}>
                  <View style={[styles.statusDot, isConnected ? styles.statusDotOnline : styles.statusDotOffline]} />
                  <Text style={[styles.statusBadgeText, isConnected ? styles.statusTextOnline : styles.statusTextOffline]}>
                    {isConnected ? 'Online' : 'Offline'}
                  </Text>
                </View>

                <TouchableOpacity
                  style={styles.topBarGroupsBtn}
                  onPress={() => navigation.navigate('Groups')}
                  activeOpacity={0.7}
                  accessibilityLabel="Open groups"
                >
                  <Icon source="account-group" size={16} color="#111111" />
                  <Text style={styles.topBarGroupsText}>Groups</Text>
                  {groups.length > 0 && (
                    <View style={styles.topBarGroupsBadge}>
                      <Text style={styles.topBarGroupsBadgeText}>{groups.length}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>

        {/* Clean Modern Search Container */}
        <View style={styles.searchContainer}>
          <Icon source="magnify" size={18} color="#9CA3AF" />
          <TextInput
            placeholder="Search by bank, card name, number..."
            placeholderTextColor="#9CA3AF"
            value={searchQuery}
            onChangeText={setSearchQuery}
            style={styles.searchInput}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.trim().length > 0 && (
            <TouchableOpacity
              onPress={() => setSearchQuery('')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Icon source="close-circle" size={16} color="#9CA3AF" />
            </TouchableOpacity>
          )}
        </View>

        {/* Filter Chips Bar (Select, All, Credit, Debit, Bank, Name) */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterChipContent}
          style={styles.filterChipScroll}
        >
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
              All ({sourceCards.length})
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
              Credit ({creditCardsCount})
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
              Debit ({debitCardsCount})
            </Text>
          </TouchableOpacity>

          {/* Bank Filter Chip */}
          <TouchableOpacity
            style={[
              styles.filterChip,
              selectedBankFilter !== null && styles.filterChipActive,
            ]}
            onPress={() => {
              setBankFilterSearch('');
              setBankFilterModalVisible(true);
            }}
            activeOpacity={0.7}
          >
            {selectedBankFilter ? (
              <BankLogo bankKey={selectedBankFilter} size={15} style={styles.chipBankLogo} />
            ) : (
              <Icon
                source="bank-outline"
                size={13}
                color="#4B5563"
              />
            )}
            <Text
              style={[
                styles.filterChipText,
                selectedBankFilter !== null && styles.filterChipTextActive,
              ]}
              numberOfLines={1}
            >
              {selectedBankFilter
                ? `${BANK_DICTIONARY[selectedBankFilter] || selectedBankFilter} (${bankCardCounts[selectedBankFilter] || 0})`
                : `Bank (${availableBanks.length})`}
            </Text>
            {selectedBankFilter ? (
              <TouchableOpacity
                onPress={(e) => {
                  e.stopPropagation?.();
                  setSelectedBankFilter(null);
                }}
                hitSlop={{ top: 8, bottom: 8, left: 6, right: 8 }}
              >
                <Icon source="close-circle" size={13} color="#FFFFFF" />
              </TouchableOpacity>
            ) : (
              <Icon source="chevron-down" size={13} color="#6B7280" />
            )}
          </TouchableOpacity>

          {/* Network Filter Chip */}
          <TouchableOpacity
            style={[
              styles.filterChip,
              selectedNetworkFilter !== null && styles.filterChipActive,
            ]}
            onPress={() => {
              setNetworkFilterSearch('');
              setNetworkFilterModalVisible(true);
            }}
            activeOpacity={0.7}
          >
            <Icon
              source="credit-card-chip-outline"
              size={13}
              color={selectedNetworkFilter !== null ? '#FFFFFF' : '#4B5563'}
            />
            <Text
              style={[
                styles.filterChipText,
                selectedNetworkFilter !== null && styles.filterChipTextActive,
              ]}
              numberOfLines={1}
            >
              {selectedNetworkFilter
                ? `${CARD_NETWORKS[selectedNetworkFilter] || selectedNetworkFilter} (${networkCardCounts[selectedNetworkFilter] || 0})`
                : `Network (${availableNetworks.length})`}
            </Text>
            {selectedNetworkFilter ? (
              <TouchableOpacity
                onPress={(e) => {
                  e.stopPropagation?.();
                  setSelectedNetworkFilter(null);
                }}
                hitSlop={{ top: 8, bottom: 8, left: 6, right: 8 }}
              >
                <Icon source="close-circle" size={13} color="#FFFFFF" />
              </TouchableOpacity>
            ) : (
              <Icon source="chevron-down" size={13} color="#6B7280" />
            )}
          </TouchableOpacity>

          {/* Network Filter Chip */}
          <TouchableOpacity
            style={[
              styles.filterChip,
              selectedNetworkFilter !== null && styles.filterChipActive,
            ]}
            onPress={() => {
              setNetworkFilterSearch('');
              setNetworkFilterModalVisible(true);
            }}
            activeOpacity={0.7}
          >
            <Icon
              source="credit-card-chip-outline"
              size={13}
              color={selectedNetworkFilter !== null ? '#FFFFFF' : '#4B5563'}
            />
            <Text
              style={[
                styles.filterChipText,
                selectedNetworkFilter !== null && styles.filterChipTextActive,
              ]}
              numberOfLines={1}
            >
              {selectedNetworkFilter
                ? `${CARD_NETWORKS[selectedNetworkFilter] || selectedNetworkFilter} (${networkCardCounts[selectedNetworkFilter] || 0})`
                : `Network (${availableNetworks.length})`}
            </Text>
            {selectedNetworkFilter ? (
              <TouchableOpacity
                onPress={(e) => {
                  e.stopPropagation?.();
                  setSelectedNetworkFilter(null);
                }}
                hitSlop={{ top: 8, bottom: 8, left: 6, right: 8 }}
              >
                <Icon source="close-circle" size={13} color="#FFFFFF" />
              </TouchableOpacity>
            ) : (
              <Icon source="chevron-down" size={13} color="#6B7280" />
            )}
          </TouchableOpacity>

          {/* Name Filter Chip */}
          <TouchableOpacity
            style={[
              styles.filterChip,
              selectedNameFilter !== null && styles.filterChipActive,
            ]}
            onPress={() => {
              setNameFilterSearch('');
              setNameFilterModalVisible(true);
            }}
            activeOpacity={0.7}
          >
            <Icon
              source="account-outline"
              size={13}
              color={selectedNameFilter !== null ? '#FFFFFF' : '#4B5563'}
            />
            <Text
              style={[
                styles.filterChipText,
                selectedNameFilter !== null && styles.filterChipTextActive,
              ]}
              numberOfLines={1}
            >
              {selectedNameFilter
                ? `${selectedNameFilter} (${nameCardCounts[selectedNameFilter.trim()] || 0})`
                : `Name (${availableNames.length})`}
            </Text>
            {selectedNameFilter ? (
              <TouchableOpacity
                onPress={(e) => {
                  e.stopPropagation?.();
                  setSelectedNameFilter(null);
                }}
                hitSlop={{ top: 8, bottom: 8, left: 6, right: 8 }}
              >
                <Icon source="close-circle" size={13} color="#FFFFFF" />
              </TouchableOpacity>
            ) : (
              <Icon source="chevron-down" size={13} color="#6B7280" />
            )}
          </TouchableOpacity>
        </ScrollView>

        <FlatList
          data={displayedCards}
          renderItem={({ item }) => {
            const currentUid = currentUser?.uid;
            const currentEmail = currentUser?.email?.toLowerCase().trim();
            const cardOwnerEmail = item.email?.toLowerCase().trim();
            const isOwnedCard = Boolean(
              (currentUid && item.ownerId && item.ownerId === currentUid) ||
              (currentEmail && cardOwnerEmail && currentEmail === cardOwnerEmail)
            );
            return (
              <CustomCard
                cardDetails={item}
                groups={groups}
                onCardLongPress={selectionMode ? toggleCardSelection : (isConnected && isOwnedCard ? showModal : undefined)}
                onCardEdit={isConnected && isOwnedCard ? showModal : undefined}
                onShare={isConnected && isOwnedCard ? handleShareCard : undefined}
                onUnshare={isConnected && isOwnedCard ? handleUnshareCard : undefined}
                selectionMode={selectionMode && isCardPersonal === 'PRL'}
                isSelected={selectedCardIds.includes(item.key)}
                onToggleSelect={toggleCardSelection}
                showYourCardLabel={isCardPersonal === 'GRP'}
              />
            );
          }}
          keyExtractor={(item, index) => item.key || index.toString()}
          style={{ flex: 1, marginBottom: 0 }}
          contentContainerStyle={{ flexGrow: 1, paddingBottom: 16 }}
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
                <View style={styles.emptyCard}>
                  <ActivityIndicator size="small" color="#111111" style={{ marginBottom: 12 }} />
                  <Text style={styles.emptyTitle}>
                    {isCardPersonal === 'PRL' ? 'Loading cards...' : 'Loading shared cards...'}
                  </Text>
                  <Text style={styles.emptySubtitle}>
                    Fetching the latest cards for your wallet
                  </Text>
                </View>
              ) : sourceCards.length === 0 ? (
                <View style={styles.emptyCard}>
                  <View style={styles.emptyIconBox}>
                    <Icon
                      source={isCardPersonal === 'PRL' ? 'credit-card-plus-outline' : 'account-group-outline'}
                      size={28}
                      color="#111111"
                    />
                  </View>
                  <Text style={styles.emptyTitle}>
                    {isCardPersonal === 'PRL' ? 'No cards yet' : 'No shared cards yet'}
                  </Text>
                  <Text style={styles.emptySubtitle}>
                    {isCardPersonal === 'PRL'
                      ? 'Add your credit or debit cards to securely manage and share them.'
                      : 'Cards shared with you or cards you share with friends and groups will appear here.'}
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
                <View style={styles.emptyCard}>
                  <View style={styles.emptyIconBox}>
                    <Icon
                      source={searchQuery.trim().length > 0 ? 'magnify' : 'credit-card-off-outline'}
                      size={28}
                      color="#111111"
                    />
                  </View>
                  <Text style={styles.emptyTitle}>
                    {searchQuery.trim().length > 0 ? 'No matching cards' : 'No cards found'}
                  </Text>
                  <Text style={styles.emptySubtitle}>
                    {searchQuery.trim().length > 0
                      ? `No cards matched "${searchQuery.trim()}". Try a different search.`
                      : (selectedBankFilter || selectedNetworkFilter || selectedNameFilter || selectedTypeFilter !== 'ALL')
                      ? 'No cards match the selected filters.'
                      : 'Try clearing your filters.'}
                  </Text>
                  {(searchQuery.trim().length > 0 || selectedTypeFilter !== 'ALL' || selectedBankFilter !== null || selectedNetworkFilter !== null || selectedNameFilter !== null) && (
                    <TouchableOpacity
                      style={styles.emptyClearButton}
                      onPress={() => {
                        setSearchQuery('');
                        setSelectedTypeFilter('ALL');
                        setSelectedBankFilter(null);
                        setSelectedNetworkFilter(null);
                        setSelectedNameFilter(null);
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
            <View style={styles.selectionBarLeft}>
              <View style={styles.selectionCountBadge}>
                <Text style={styles.selectionCount}>{selectedCardIds.length}</Text>
              </View>
              <Text style={styles.selectionLabel}>selected</Text>
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
            <View style={styles.selectionBarRight}>
              <TouchableOpacity
                style={[styles.unshareSelectedButton, (selectedCardIds.length === 0 || !isConnected) && { opacity: 0.5 }]}
                disabled={selectedCardIds.length === 0 || !isConnected}
                onPress={handleUnshareSelected}
                activeOpacity={0.7}
              >
                <Icon source="share-off" size={15} color="#FFFFFF" />
                <Text style={styles.unshareSelectedText}>Unshare</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.shareSelectedButton, (selectedCardIds.length === 0 || !isConnected) && { opacity: 0.5 }]}
                disabled={selectedCardIds.length === 0 || !isConnected}
                onPress={handleShareSelected}
                activeOpacity={0.7}
              >
                <Icon source="share-variant" size={15} color="#111111" />
                <Text style={styles.shareSelectedText}>Share</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={styles.bottomTabContainer}>
          <View style={styles.bottomTabCard}>
            <TouchableOpacity
              style={[styles.bottomTab, isCardPersonal === 'PRL' && styles.bottomTabActive]}
              onPress={() => {
                setIsCardPersonal('PRL');
                setSelectionMode(false);
                setSelectedCardIds([]);
              }}
              activeOpacity={0.8}
            >
              <Icon
                source="credit-card"
                size={16}
                color={isCardPersonal === 'PRL' ? '#FFFFFF' : '#6B7280'}
              />
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
              <Icon
                source="account-group"
                size={16}
                color={isCardPersonal === 'GRP' ? '#FFFFFF' : '#6B7280'}
              />
              <Text style={[styles.bottomTabText, isCardPersonal === 'GRP' && styles.bottomTabTextActive]}>
                Shared Cards
              </Text>
              <View style={[styles.bottomTabBadge, isCardPersonal === 'GRP' ? styles.bottomTabBadgeActive : styles.bottomTabBadgeInactive]}>
                <Text style={[styles.bottomTabBadgeText, isCardPersonal === 'GRP' ? styles.bottomTabBadgeTextActive : styles.bottomTabBadgeTextInactive]}>
                  {allSharedCards.length}
                </Text>
              </View>
            </TouchableOpacity>
          </View>
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
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
  },
  topBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    marginRight: 8,
  },
  avatarWrap: {
    position: 'relative',
  },
  avatarImage: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1.5,
    borderColor: '#E4E4E7',
  },
  avatarPlaceholder: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  avatarStatusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    position: 'absolute',
    bottom: -1,
    right: -1,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  dotOnline: {
    backgroundColor: '#10B981',
  },
  dotOffline: {
    backgroundColor: '#EF4444',
  },
  userInfoWrap: {
    flex: 1,
  },
  appTitleText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#71717A',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  userNameText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111111',
    letterSpacing: -0.3,
  },
  userNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  privacyToggleBtn: {
    padding: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  topBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  statusBadgeOnline: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  statusBadgeOffline: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusDotOnline: {
    backgroundColor: '#10B981',
  },
  statusDotOffline: {
    backgroundColor: '#EF4444',
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  statusTextOnline: {
    color: '#047857',
  },
  statusTextOffline: {
    color: '#B91C1C',
  },
  topBarGroupsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E4E4E7',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.02,
    shadowRadius: 2,
    elevation: 1,
  },
  topBarGroupsText: {
    fontSize: 12,
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
  // Selection Top Bar
  selectionTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flex: 1,
  },
  selectionTitleContainer: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
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
    fontSize: 14,
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
  // Search
  searchContainer: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E4E4E7',
    borderRadius: 12,
    height: 42,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.02,
    shadowRadius: 3,
    elevation: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    color: '#111111',
    marginLeft: 8,
    paddingVertical: 0,
  },
  // Filter Chips
  filterChipContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 8,
    gap: 8,
  },
  filterChipScroll: {
    flexGrow: 0,
    marginBottom: 8,
  },
  filterChipContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 8,
  },
  chipBankLogo: {
    marginRight: 2,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E4E4E7',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    gap: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.02,
    shadowRadius: 2,
    elevation: 1,
  },
  filterChipActive: {
    backgroundColor: '#111111',
    borderColor: '#111111',
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4B5563',
  },
  filterChipTextActive: {
    color: '#FFFFFF',
  },
  // Selection Bar
  selectionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginBottom: 6,
    backgroundColor: '#111111',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 3,
  },
  selectionBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  selectionCountBadge: {
    backgroundColor: '#374151',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  selectionCount: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 12,
  },
  selectionLabel: {
    color: '#D1D5DB',
    fontWeight: '600',
    fontSize: 12,
  },
  selectAllHeaderBtn: {
    color: '#9CA3AF',
    fontSize: 12,
    fontWeight: '600',
    textDecorationLine: 'underline',
    marginLeft: 4,
  },
  selectionBarRight: {
    flexDirection: 'row',
    gap: 8,
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
    fontSize: 12,
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
    fontSize: 12,
  },
  // Bottom Tabs
  bottomTabContainer: {
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 8,
    backgroundColor: '#F4F5F7',
  },
  bottomTabCard: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E4E4E7',
    padding: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  bottomTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderRadius: 10,
    gap: 6,
  },
  bottomTabActive: {
    backgroundColor: '#111111',
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
    backgroundColor: '#F3F4F6',
  },
  bottomTabBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  bottomTabBadgeTextActive: {
    color: '#FFFFFF',
  },
  bottomTabBadgeTextInactive: {
    color: '#4B5563',
  },
  // FAB
  fab: {
    backgroundColor: '#111111',
    borderRadius: 16,
    bottom: 78,
    right: 16,
    position: 'absolute',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  // Empty State
  emptyContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 20,
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E4E4E7',
    padding: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 16,
    maxWidth: 340,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 1,
  },
  emptyIconBox: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: '#F4F5F7',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111111',
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 6,
    textAlign: 'center',
    lineHeight: 18,
  },
  emptyActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#111111',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: 18,
  },
  emptyActionButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  emptyClearButton: {
    backgroundColor: '#F4F5F7',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    marginTop: 14,
  },
  emptyClearButtonText: {
    color: '#374151',
    fontWeight: '600',
    fontSize: 12,
  },
  // Confirm Dialog
  confirmDialog: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    marginHorizontal: 28,
  },
  confirmDialogContent: {
    padding: 20,
  },
  confirmHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  confirmIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 10,
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
    color: '#6B7280',
    lineHeight: 20,
    marginBottom: 20,
  },
  confirmDialogActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  confirmCancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
  },
  confirmCancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
  confirmActionBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmActionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  // Filter Modals
  filterModalContainer: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 20,
    borderRadius: 18,
    paddingTop: 18,
    paddingHorizontal: 18,
    paddingBottom: 12,
    maxHeight: '80%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  filterModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  filterModalHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  filterModalIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterModalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111111',
  },
  filterModalSearchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 38,
    marginBottom: 10,
  },
  filterModalSearchInput: {
    flex: 1,
    fontSize: 13,
    color: '#111111',
    marginLeft: 6,
    paddingVertical: 0,
  },
  filterModalList: {
    maxHeight: 340,
  },
  filterModalListContent: {
    paddingBottom: 8,
  },
  filterModalItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 10,
    marginBottom: 4,
    backgroundColor: '#FAFAFA',
  },
  filterModalItemRowSelected: {
    backgroundColor: '#EEF2FF',
  },
  filterModalAllIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  filterModalBankLogo: {
    marginRight: 12,
  },
  filterModalNetworkBadge: {
    width: 42,
    height: 28,
    borderRadius: 6,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  filterModalNetworkBadgeText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 10,
    letterSpacing: 0.5,
  },
  filterModalNameAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  filterModalNameAvatarText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  filterModalItemTextWrap: {
    flex: 1,
  },
  filterModalItemTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111111',
  },
  filterModalItemTitleSelected: {
    color: '#2563EB',
    fontWeight: '700',
  },
  filterModalItemSub: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
  },
  filterModalEmpty: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  filterModalEmptyText: {
    fontSize: 13,
    color: '#9CA3AF',
  },
});
