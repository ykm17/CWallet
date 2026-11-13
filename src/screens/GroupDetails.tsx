import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Alert, FlatList, TouchableOpacity, TextInput as RNTextInput } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, Dialog, Icon, Portal, Text } from 'react-native-paper';
import auth from '@react-native-firebase/auth';
import { RootStackParamList } from '../App';
import { Card, Group, GroupMember } from '../types/Types';
import { addMemberToGroup, deleteGroup, listenGroup, listenGroupMembers, removeMemberFromGroup, upgradePendingMembersIfRegistered } from '../services/groupService';
import { listenAccessForGroup } from '../services/sharingService';
import { fetchCardsByIds } from '../services/cardService';
import CustomCard from '../components/CustomCard';
import { contributionLabel } from '../services/sharingUtils';
import { useUserGroups } from '../hooks/useUserGroups';

type Props = NativeStackScreenProps<RootStackParamList, 'GroupDetails'>;

const GroupDetails: React.FC<Props> = ({ navigation, route }) => {
  const { groupId } = route.params;
  const uid = auth().currentUser?.uid;
  const { groups } = useUserGroups();
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [accessCount, setAccessCount] = useState<number | null>(null);
  const [memberEmail, setMemberEmail] = useState('');
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState<'cards' | 'members'>('cards');
  const [deleteVisible, setDeleteVisible] = useState(false);

  const isOwner = group?.ownerId === uid;
  const userCardsInGroup = cards.filter(
    (c) => c.ownerId === uid || c.email === auth().currentUser?.email,
  );

  useEffect(() => {
    navigation.setOptions({
      title: group?.name || 'Group',
      headerTitleAlign: 'center',
      headerStyle: { backgroundColor: '#F4F5F7' },
      headerRight: () => isOwner ? (
        <TouchableOpacity onPress={() => navigation.navigate('GroupForm', { groupId })}>
          <Text style={styles.headerAction}>Edit</Text>
        </TouchableOpacity>
      ) : null,
    });
  }, [group?.name, isOwner, groupId, navigation]);

  useEffect(() => {
    const unsubGroup = listenGroup(groupId, setGroup, (error) => {
      Alert.alert('Group unavailable', error.message);
      navigation.goBack();
    });
    const unsubMembers = listenGroupMembers(groupId, (nextMembers) => {
      setMembers(nextMembers);
      if (isOwner) {
        upgradePendingMembersIfRegistered(groupId, nextMembers);
      }
    });
    const unsubAccess = listenAccessForGroup(groupId, async (access) => {
      setAccessCount(access.length);
      const nextCards = await fetchCardsByIds(access.map((item) => item.cardId));
      const groupNameById = groups.reduce<Record<string, string>>((acc, g) => { acc[g.groupId] = g.name; return acc; }, {});
      const enrichedCards = nextCards.map((c) => {
        const gnames = (c.sharedGroupIds || []).map((id) => groupNameById[id]).filter(Boolean);
        return {
          ...c,
          accessGroupNames: gnames.length > 0 ? gnames : (group?.name ? [group.name] : []),
        };
      });
      setCards(enrichedCards);
    });
    return () => {
      unsubGroup();
      unsubMembers();
      unsubAccess();
    };
  }, [groupId, navigation, isOwner]);

  const handleAddMember = async () => {
    if (!memberEmail.trim()) {
      return;
    }
    try {
      setAdding(true);
      const result = await addMemberToGroup(groupId, memberEmail);
      setMemberEmail('');
      if (result.isPending) {
        Alert.alert(
          'Invitation Added',
          `${result.email} was added as a pending member. Once they sign in to CWallet, their access will activate automatically.`,
        );
      } else {
        Alert.alert(
          'Member Added',
          `${result.user?.displayName || result.email} was added to the group.`,
        );
      }
    } catch (error: any) {
      Alert.alert('Could not add member', error.message || 'Please try again.');
    } finally {
      setAdding(false);
    }
  };

  const handleRemoveMember = (member: GroupMember) => {
    Alert.alert(
      'Remove member',
      `Remove ${member.displayName || member.email} from this group? They will lose access through this group only.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await removeMemberFromGroup(groupId, member.userId);
            } catch (error: any) {
              Alert.alert('Could not remove member', error.message);
            }
          },
        },
      ],
    );
  };

  const handleUnshareCardFromGroup = (card: Card) => {
    navigation.navigate('UnshareFromGroup', { cardIds: [card.key], groupId });
  };

  const handleDeleteGroup = async () => {
    try {
      await deleteGroup(groupId);
      setDeleteVisible(false);
      navigation.goBack();
    } catch (error: any) {
      Alert.alert('Could not delete group', error.message);
    }
  };

  const renderMember = ({ item }: { item: GroupMember }) => {
    const isPending = item.status === 'pending';
    return (
      <View style={styles.memberRow}>
        <View style={[styles.memberAvatar, isPending && styles.memberAvatarPending]}>
          <Text style={[styles.memberAvatarText, isPending && styles.memberAvatarTextPending]}>
            {(item.displayName || item.email || '?').charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.memberName}>{item.displayName || 'CWallet user'}</Text>
          <Text style={styles.memberEmail}>{item.email || item.appleUserId || item.userId}</Text>
        </View>
        <View style={[styles.roleBadge, isPending ? styles.pendingBadge : item.role === 'owner' ? styles.ownerBadge : styles.memberBadge]}>
          <Text style={[styles.roleBadgeText, isPending ? styles.pendingBadgeText : item.role === 'owner' ? styles.ownerBadgeText : styles.memberBadgeText]}>
            {item.role === 'owner' ? 'Owner' : isPending ? 'Pending' : 'Member'}
          </Text>
        </View>
        {isOwner && item.role !== 'owner' && (
          <TouchableOpacity onPress={() => handleRemoveMember(item)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Icon source="close-circle-outline" size={20} color="#D32F2F" />
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const cardsCount = accessCount !== null ? accessCount : cards.length;
  const membersCount = members.length > 0 ? members.length : (group?.memberCount || 0);

  return (
    <View style={styles.container}>
      <View style={styles.summaryCard}>
        <Text style={styles.groupTitle}>{group?.name || 'Loading...'}</Text>
        <Text style={styles.summaryMeta}>
          {group ? `${group.memberCount} members · ${contributionLabel(group.contributionPermission)}` : ''}
        </Text>
        <View style={styles.actionButtonsRow}>
          <TouchableOpacity
            style={[
              styles.actionBtn,
              styles.shareBtn,
              (!isOwner && group?.contributionPermission === 'owner_only') && styles.disabledBtn,
            ]}
            onPress={() => navigation.navigate('ShareToGroup', { groupId })}
            disabled={!isOwner && group?.contributionPermission === 'owner_only'}
            activeOpacity={0.7}
          >
            <Icon source="share-variant" size={16} color="#FFFFFF" />
            <Text style={styles.actionBtnText}>Share cards</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.actionBtn,
              styles.unshareBtn,
              userCardsInGroup.length === 0 && styles.disabledBtn,
            ]}
            onPress={() => navigation.navigate('UnshareFromGroup', { groupId })}
            disabled={userCardsInGroup.length === 0}
            activeOpacity={0.7}
          >
            <Icon source="share-off" size={16} color="#FFFFFF" />
            <Text style={styles.actionBtnText}>Unshare cards</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tab, tab === 'cards' && styles.tabActive]}
          onPress={() => setTab('cards')}
          activeOpacity={0.8}
        >
          <Text style={[styles.tabText, tab === 'cards' && styles.tabTextActive]}>
            Shared cards
          </Text>
          <View style={[styles.tabBadge, tab === 'cards' ? styles.tabBadgeActive : styles.tabBadgeInactive]}>
            <Text style={[styles.tabBadgeText, tab === 'cards' ? styles.tabBadgeTextActive : styles.tabBadgeTextInactive]}>
              {cardsCount}
            </Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, tab === 'members' && styles.tabActive]}
          onPress={() => setTab('members')}
          activeOpacity={0.8}
        >
          <Text style={[styles.tabText, tab === 'members' && styles.tabTextActive]}>
            Members
          </Text>
          <View style={[styles.tabBadge, tab === 'members' ? styles.tabBadgeActive : styles.tabBadgeInactive]}>
            <Text style={[styles.tabBadgeText, tab === 'members' ? styles.tabBadgeTextActive : styles.tabBadgeTextInactive]}>
              {membersCount}
            </Text>
          </View>
        </TouchableOpacity>
      </View>

      {tab === 'cards' ? (
        <FlatList
          data={cards}
          keyExtractor={(item) => item.key}
          renderItem={({ item }) => (
            <CustomCard
              cardDetails={item}
              showYourCardLabel={item.ownerId === uid || item.email === auth().currentUser?.email}
              onShare={
                item.ownerId === uid || item.email === auth().currentUser?.email
                  ? (card) => navigation.navigate('ShareToGroup', { cardIds: [card.key] })
                  : undefined
              }
              onUnshare={
                item.ownerId === uid || item.email === auth().currentUser?.email
                  ? handleUnshareCardFromGroup
                  : undefined
              }
            />
          )}
          contentContainerStyle={cards.length === 0 ? styles.emptyContainer : { paddingBottom: 24 }}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Icon source="credit-card-off-outline" size={44} color="#9CA3AF" />
              <Text style={styles.emptyTitle}>No cards in this group yet</Text>
              <Text style={styles.emptySubtitle}>
                {group?.contributionPermission === 'owner_only' && !isOwner
                  ? 'Only the group owner can share cards to this group.'
                  : 'Share cards from your wallet so group members can access them.'}
              </Text>
              {(isOwner || group?.contributionPermission !== 'owner_only') && (
                <TouchableOpacity
                  style={styles.emptyActionButton}
                  onPress={() => navigation.navigate('ShareToGroup', { groupId })}
                  activeOpacity={0.8}
                >
                  <Icon source="share-variant" size={15} color="#FFFFFF" />
                  <Text style={styles.emptyActionButtonText}>Share your cards</Text>
                </TouchableOpacity>
              )}
            </View>
          }
        />
      ) : (
        <FlatList
          data={members}
          keyExtractor={(item) => item.userId}
          renderItem={renderMember}
          contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
          ListHeaderComponent={
            isOwner ? (
              <View style={styles.addMemberBox}>
                <Text style={styles.addMemberTitle}>Add member</Text>
                <Text style={styles.addMemberHelp}>
                  Use the email on their CWallet account, or their Apple user identifier for iOS Apple accounts.
                </Text>
                <View style={styles.addRow}>
                  <RNTextInput
                    value={memberEmail}
                    onChangeText={setMemberEmail}
                    placeholder="email@example.com"
                    autoCapitalize="none"
                    keyboardType="email-address"
                    style={styles.emailInput}
                    placeholderTextColor="#9CA3AF"
                  />
                  <TouchableOpacity style={styles.addButton} onPress={handleAddMember} disabled={adding}>
                    <Text style={styles.addButtonText}>{adding ? '...' : 'Add'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null
          }
          ListFooterComponent={
            isOwner ? (
              <Button
                mode="outlined"
                textColor="#D32F2F"
                onPress={() => setDeleteVisible(true)}
                style={styles.deleteButton}
              >
                Delete group
              </Button>
            ) : null
          }
        />
      )}

      <Portal>
        <Dialog visible={deleteVisible} onDismiss={() => setDeleteVisible(false)} style={styles.dialog}>
          <Dialog.Title>Delete group</Dialog.Title>
          <Dialog.Content>
            <Text>This removes the group and its sharing permissions. Original cards are not deleted.</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setDeleteVisible(false)}>Cancel</Button>
            <Button textColor="#D32F2F" onPress={handleDeleteGroup}>Delete</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
};

export default GroupDetails;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F4F5F7',
  },
  headerAction: {
    color: 'black',
    fontWeight: '600',
  },
  summaryCard: {
    backgroundColor: '#FFFFFF',
    margin: 12,
    padding: 16,
    borderRadius: 12,
  },
  groupTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111111',
  },
  summaryMeta: {
    marginTop: 4,
    color: '#6B7280',
  },
  actionButtonsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
    gap: 6,
  },
  actionBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  shareBtn: {
    backgroundColor: '#111111',
  },
  unshareBtn: {
    backgroundColor: '#374151',
  },
  disabledBtn: {
    opacity: 0.45,
  },
  tabRow: {
    flexDirection: 'row',
    marginHorizontal: 12,
    backgroundColor: '#E5E7EB',
    borderRadius: 10,
    padding: 4,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderRadius: 8,
    gap: 6,
  },
  tabActive: {
    backgroundColor: '#111111',
  },
  tabText: {
    fontWeight: '700',
    fontSize: 13,
    color: '#4B5563',
  },
  tabTextActive: {
    color: '#FFFFFF',
  },
  tabBadge: {
    paddingHorizontal: 7,
    paddingVertical: 1.5,
    borderRadius: 6,
    minWidth: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBadgeActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
  },
  tabBadgeInactive: {
    backgroundColor: '#D1D5DB',
  },
  tabBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  tabBadgeTextActive: {
    color: '#FFFFFF',
  },
  tabBadgeTextInactive: {
    color: '#374151',
  },
  emptyContainer: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  emptyState: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  emptyTitle: {
    marginTop: 12,
    fontSize: 16,
    fontWeight: '700',
    color: '#374151',
  },
  emptySubtitle: {
    marginTop: 6,
    color: '#6B7280',
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 18,
  },
  emptyActionButton: {
    marginTop: 16,
    backgroundColor: '#111111',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  emptyActionButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  emptyText: {
    marginTop: 8,
    color: '#6B7280',
    textAlign: 'center',
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    gap: 10,
  },
  memberAvatar: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatarPending: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  memberAvatarText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  memberAvatarTextPending: {
    color: '#B45309',
  },
  memberName: {
    fontWeight: '700',
    color: '#111111',
  },
  memberEmail: {
    color: '#6B7280',
    fontSize: 12,
  },
  roleBadge: {
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  ownerBadge: {
    backgroundColor: '#EEF2FF',
  },
  memberBadge: {
    backgroundColor: '#F3F4F6',
  },
  pendingBadge: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  roleBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#374151',
  },
  ownerBadgeText: {
    color: '#4338CA',
  },
  memberBadgeText: {
    color: '#374151',
  },
  pendingBadgeText: {
    color: '#B45309',
  },
  addMemberBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  addMemberTitle: {
    fontWeight: '700',
    color: '#111111',
  },
  addMemberHelp: {
    marginTop: 4,
    marginBottom: 10,
    color: '#6B7280',
    fontSize: 12,
  },
  addRow: {
    flexDirection: 'row',
    gap: 8,
  },
  emailInput: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    paddingHorizontal: 12,
    color: '#111111',
  },
  addButton: {
    backgroundColor: '#111111',
    borderRadius: 8,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  addButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  deleteButton: {
    marginTop: 16,
    borderColor: '#D32F2F',
  },
  dialog: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
  },
});
