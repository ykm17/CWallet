import { View, SafeAreaView, StyleSheet, TouchableOpacity, FlatList, BackHandler } from 'react-native';
import React, { useContext, useEffect, useState } from 'react';
import CustomCard from '../components/CustomCard';
import CardFormModal from '../components/CardFormModal';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../App';
import auth from '@react-native-firebase/auth';
import { Card } from '../types/Types';
import { FAB, Text, SegmentedButtons, Searchbar, Icon } from 'react-native-paper';
import { isEmpty } from 'lodash';
import { BANK_DICTIONARY, CARD_NETWORKS, CARD_TYPES } from '../constants/Constants';
import { getFirestore, collection, doc, addDoc, updateDoc, query, where, onSnapshot, serverTimestamp } from '@react-native-firebase/firestore';
import { decryptCardData, encryptCardData } from '../util/Crypto';
import { ConnectivityContext } from '../util/Connectivity';
import { detectCardType } from '../util/Utils';
import EncryptedStorage from 'react-native-encrypted-storage';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

const Home: React.FC<Props> = ({ navigation }) => {
  const db = getFirestore();
  const [modalVisible, setModalVisible] = useState(false);
  const [cardToEdit, setCardToEdit] = useState<Card | null>(null);
  const [cardData, setCardData] = useState<Card[]>([]);
  const [isCardPersonal, setIsCardPersonal] = useState('PRL');
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<'ALL' | 'CREDIT' | 'DEBIT'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [loadingScreen, setLoadingScreen] = useState('Loading cards');
  const { isConnected } = useContext(ConnectivityContext);

  const getCardEffectiveType = (card: Card): string => {
    if (card.cardType) return card.cardType.toUpperCase();
    const detected = detectCardType(card.name);
    if (detected) return detected.toUpperCase();
    if (card.limit && Number(card.limit.replace(/\D/g, '')) > 0) return 'CREDIT';
    return '';
  };

  const filteredCards = cardData.filter((card) => {
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
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity onPress={signOutUser}>
          <Text style={{ color: 'black' }}>Logout</Text>
        </TouchableOpacity>
      ),
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

  useEffect(() => {
    // Handle hardware back press on Android
    const onBackPress = () => {
      if (modalVisible) {
        hideModal();
        return true;
      }
      BackHandler.exitApp();
      return true;
    };

    const backHandler = BackHandler.addEventListener(
      'hardwareBackPress',
      onBackPress
    );

    return () => backHandler.remove();
  }, [modalVisible]);

  useEffect(() => {
    try {
      if (isConnected) {
        console.log("Fetching cards for user:", auth().currentUser?.uid);
        const q = query(collection(db, 'cards'), where('ownerId', '==', auth().currentUser?.uid));
        const unsubscribe = onSnapshot(q, (snapshot) => {
          console.log("Snapshot received:", snapshot.size, "documents");
          const cards: Card[] = [];

          snapshot.forEach((snapshotDoc: any) => {
            const data = snapshotDoc.data();
            console.log("Processing document:", snapshotDoc.id, data);

            if (!data.encryptedData) {
              console.error("Document missing encryptedData:", snapshotDoc.id);
              return;
            }

            try {
              const decryptedCard = decryptCardData(data.encryptedData);
              if (decryptedCard) {
                cards.push({
                  ...decryptedCard,
                  key: snapshotDoc.id,
                });
              }
            } catch (decryptError) {
              console.error("Error decrypting card:", snapshotDoc.id, decryptError);
            }
          });

          console.log("Processed cards:", cards.length);
          setCardData(cards);
          saveCardsInSecureStorage(cards);
        }, (error) => {
          console.error("Snapshot listener error:", error);
        });

        const qGroup = query(collection(db, 'cards'), where('isPersonal', '==', false));
        const unsubscribeGroup = onSnapshot(qGroup, (snapshot) => {
          console.log("Snapshot received (group):", snapshot.size, "documents");
          const groupCards: Card[] = [];

          snapshot.forEach((snapshotDoc: any) => {
            const data = snapshotDoc.data();
            console.log("Processing document (group):", snapshotDoc.id, data);

            if (!data.encryptedData) {
              console.error("Document missing encryptedData (group):", snapshotDoc.id);
              return;
            }

            try {
              const decryptedCard = decryptCardData(data.encryptedData);
              if (decryptedCard) {
                groupCards.push({
                  ...decryptedCard,
                  key: snapshotDoc.id,
                });
              }
            } catch (decryptError) {
              console.error("Error decrypting card (group):", snapshotDoc.id, decryptError);
            }
          });

          console.log("Processed group cards:", groupCards.length);
          setCardData(prev => {
            const combined = [...prev];
            groupCards.forEach(groupCard => {
              if (!combined.some(c => c.key === groupCard.key)) {
                combined.push(groupCard);
              }
            });
            return combined;
          });
        }, (error) => {
          console.error("Snapshot listener error (group):", error);
        });

        return () => {
          unsubscribe();
          unsubscribeGroup();
        };
      } else {
        fetchCardsFromStorage();
      }
    } catch (e) {
      console.error("Error setting up snapshot listeners:", e);
    }
  }, [isConnected]);

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
      const cardDocData = {
        ownerId: auth().currentUser?.uid,
        encryptedData,
        addedAt: serverTimestamp(),
        isPersonal: savedCard.isPersonal,
        sharedGroupIds: [],
      };

      console.log("Creating/updating card with data:", cardDocData);

      if (savedCard.key) {
        console.log("Updating existing card:", savedCard.key);
        await updateDoc(doc(db, 'cards', savedCard.key), cardDocData);
      } else {
        console.log("Creating new card");
        await addDoc(collection(db, 'cards'), cardDocData);
      }

      setIsCardPersonal(savedCard.isPersonal ? 'PRL' : 'GRP');
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

  const displayedCards = filteredCards
    .filter((card) =>
      isCardPersonal === 'PRL'
        ? card.isPersonal && card.email === auth().currentUser?.email
        : !card.isPersonal
    )
    .filter((card) => {
      if (selectedTypeFilter === 'ALL') return true;
      const effectiveType = getCardEffectiveType(card);
      return effectiveType === selectedTypeFilter;
    });

  return (
    <SafeAreaView style={styles.mainContainer}>
      <View style={{ flex: 1 }}>
        <CardFormModal
          visible={modalVisible}
          onDismiss={hideModal}
          cardToEdit={cardToEdit}
          onSubmit={handleSaveCard}
        />

        <Searchbar
          placeholder="Search"
          onChangeText={setSearchQuery}
          value={searchQuery}
          style={styles.searchBar}
          inputStyle={{ color: 'white' }}
          iconColor="white"
          placeholderTextColor="white"
          selectionColor="white"
        />

        {/* Credit / Debit Filter Chips */}
        <View style={styles.filterChipContainer}>
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
            <CustomCard cardDetails={item} onCardLongPress={showModal} onCardEdit={showModal} />
          )}
          keyExtractor={(item, index) => item.key || index.toString()}
          style={{ flex: 1, marginBottom: 0 }}
          contentContainerStyle={{ flexGrow: 1 }}
          ListEmptyComponent={
            <View style={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20 }}>
              <Icon source="credit-card-off-outline" size={44} color="#9CA3AF" />
              <Text style={{ fontSize: 16, color: '#6B7280', marginTop: 10, textAlign: 'center' }}>
                {cardData.length === 0
                  ? loadingScreen
                  : selectedTypeFilter !== 'ALL'
                  ? `No ${selectedTypeFilter === 'CREDIT' ? 'Credit' : 'Debit'} cards found in ${isCardPersonal === 'PRL' ? 'Personal' : 'Group'}`
                  : `No cards found in ${isCardPersonal === 'PRL' ? 'Personal' : 'Group'}`}
              </Text>
            </View>
          }
        />

        <SegmentedButtons
          value={isCardPersonal}
          onValueChange={setIsCardPersonal}
          buttons={[
            {
              value: 'PRL',
              label: 'Personal',
              style: { backgroundColor: isCardPersonal === 'PRL' ? '#000000' : '#E5E7EB' },
              checkedColor: '#ffffff',
            },
            {
              value: 'GRP',
              label: 'Group',
              style: { backgroundColor: isCardPersonal === 'GRP' ? '#000000' : '#E5E7EB' },
              checkedColor: '#ffffff',
            },
          ]}
          style={{ marginVertical: 10, marginHorizontal: 10 }}
        />

        <FAB
          visible={isConnected}
          icon="plus"
          style={styles.fab}
          color="white"
          onPress={() => {
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
    borderRadius: 30,
    bottom: 80,
    right: 10,
    position: 'absolute',
  },
  searchBar: {
    marginHorizontal: 10,
    marginTop: 15,
    marginBottom: 8,
    elevation: 2,
    backgroundColor: 'black',
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
    paddingVertical: 5,
    borderRadius: 16,
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
});
