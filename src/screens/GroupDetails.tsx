import React, { useContext, useEffect, useState, useRef } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, TextInput as RNTextInput, RefreshControl, ActivityIndicator } from 'react-native';
import { Alert } from '../components/CustomAlert';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, Dialog, Icon, Portal, Text } from 'react-native-paper';
import auth from '@react-native-firebase/auth';
import { RootStackParamList } from '../App';
import { Card, Group, GroupMember } from '../types/Types';
import { addMemberToGroup, deleteGroup, leaveGroup, listenGroup, listenGroupMembers, removeMemberFromGroup, upgradePendingMembersIfRegistered } from '../services/groupService';
import { listenAccessForGroup } from '../services/sharingService';
import { fetchCardsByIds } from '../services/cardService';
import CustomCard from '../components/CustomCard';
import { contributionLabel } from '../services/sharingUtils';
import { useUserGroups } from '../hooks/useUserGroups';
import { ConnectivityContext } from '../util/Connectivity';

type Props = NativeStackScreenProps<RootStackParamList, 'GroupDetails'>;

const GroupDetails: React.FC<Props> = ({ navigation, route }) => {
  const { groupId } = route.params;
  const uid = auth().currentUser?.uid;
  const { isConnected } = useContext(ConnectivityContext);
  const { groups } = useUserGroups();
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [accessCount, setAccessCount] = useState<number | null>(null);
  const [memberEmail, setMemberEmail] = useState('');
  const [adding, setAdding] = useState(false);
  const addingRef = useRef(false);
  const [tab, setTab] = useState<'cards' | 'members'>('cards');
  const [deleteVisible, setDeleteVisible] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deletingRef = useRef(false);
  const [leaveVisible, setLeaveVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const leavingRef = useRef(false);
  const removingMemberRef = useRef(false);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      if (isConnected && isOwner) {
        await upgradePendingMembersIfRegistered(groupId, members);
      }
    } catch (e) {
      console.error('Failed to refresh group details:', e);
    } finally {
      setTimeout(() => setRefreshing(false), 400);
    }
  };

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
        <TouchableOpacity
          onPress={() => {
            if (!isConnected) {
              Alert.alert('Offline', 'You must be online to edit this group.');
              return;
            }
            navigation.navigate('GroupForm', { groupId });
          }}
          style={[styles.headerEditBtn, !isConnected && { opacity: 0.5 }]}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Icon source="pencil-outline" size={15} color="#111111" />
          <Text style={styles.headerEditText}>Edit</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          onPress={() => {
            if (!isConnected) {
              Alert.alert('Offline', 'You must be online to leave this group.');
              return;
            }
            setLeaveVisible(true);
          }}
          style={[styles.headerLeaveBtn, !isConnected && { opacity: 0.5 }]}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Icon source="exit-to-app" size={15} color="#DC2626" />
          <Text style={styles.headerLeaveText}>Leave</Text>
        </TouchableOpacity>
      ),
    });
  }, [group?.name, isOwner, groupId, navigation, isConnected]);

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
    if (adding || addingRef.current) return;
    if (!isConnected) {
      Alert.alert('Offline', 'You must be online to add group members.');
      return;
    }
    if (!memberEmail.trim()) {
      return;
    }
    try {
      addingRef.current = true;
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
      addingRef.current = false;
      setAdding(false);
    }
  };

  const handleRemoveMember = (member: GroupMember) => {
    if (removingMemberRef.current) return;
    if (!isConnected) {
      Alert.alert('Offline', 'You must be online to remove group members.');
      return;
    }
    Alert.alert(
      'Remove member',
      `Remove ${member.displayName || member.email} from this group? They will lose access through this group only.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            if (removingMemberRef.current) return;
            try {
              removingMemberRef.current = true;
              await removeMemberFromGroup(groupId, member.userId);
            } catch (error: any) {
              Alert.alert('Could not remove member', error.message);
            } finally {
              removingMemberRef.current = false;
            }
          },
        },
      ],
    );
  };

  const handleUnshareCardFromGroup = (card: Card) => {
    if (!isConnected) {
      Alert.alert('Offline', 'You must be online to unshare cards.');
      return;
    }
    navigation.navigate('UnshareFromGroup', { cardIds: [card.key], groupId });
  };

  const handleDeleteGroup = async () => {
    if (deleting || deletingRef.current) return;
    if (!isConnected) {
      Alert.alert('Offline', 'You must be online to delete this group.');
      return;
    }
    try {
      deletingRef.current = true;
      setDeleting(true);
      await deleteGroup(groupId);
      setDeleteVisible(false);
      navigation.goBack();
    } catch (error: any) {
      Alert.alert('Could not delete group', error.message);
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  };

  const handleLeaveGroup = async () => {
    if (leaving || leavingRef.current) return;
    if (!isConnected) {
      Alert.alert('Offline', 'You must be online to leave this group.');
      return;
    }
    try {
      leavingRef.current = true;
      setLeaving(true);
      await leaveGroup(groupId);
      setLeaveVisible(false);
      navigation.goBack();
    } catch (error: any) {
      Alert.alert('Could not leave group', error.message || 'Please try again.');
    } finally {
      leavingRef.current = false;
      setLeaving(false);
    }
  };

  const renderMember = ({ item }: { item: GroupMember }) => {
    const isPending = item.status === 'pending';
    const isCurrentUser = item.userId === uid;
    return (
      <View style={styles.memberRow}>
        <View style={[styles.memberAvatar, isPending && styles.memberAvatarPending]}>
          <Text style={[styles.memberAvatarText, isPending && styles.memberAvatarTextPending]}>
            {(item.displayName || item.email || '?').charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={styles.memberName}>{item.displayName || 'CWallet user'}</Text>
            {isCurrentUser && (
              <View style={styles.youBadge}>
                <Text style={styles.youBadgeText}>You</Text>
              </View>
            )}
          </View>
          <Text style={styles.memberEmail}>{item.email || item.appleUserId || item.userId}</Text>
        </View>
        <View style={[styles.roleBadge, isPending ? styles.pendingBadge : item.role === 'owner' ? styles.ownerBadge : styles.memberBadge]}>
          <Text style={[styles.roleBadgeText, isPending ? styles.pendingBadgeText : item.role === 'owner' ? styles.ownerBadgeText : styles.memberBadgeText]}>
            {item.role === 'owner' ? 'Owner' : isPending ? 'Pending' : 'Member'}
          </Text>
        </View>
        {isOwner && item.role !== 'owner' && (
          <TouchableOpacity
            onPress={() => handleRemoveMember(item)}
            disabled={!isConnected}
            style={!isConnected && { opacity: 0.3 }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon source="close-circle-outline" size={20} color="#D32F2F" />
          </TouchableOpacity>
        )}
        {!isOwner && isCurrentUser && (
          <TouchableOpacity
            onPress={() => setLeaveVisible(true)}
            disabled={!isConnected}
            style={[styles.memberLeaveRowBtn, !isConnected && { opacity: 0.4 }]}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon source="exit-to-app" size={14} color="#DC2626" />
            <Text style={styles.memberLeaveRowText}>Leave</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const cardsCount = accessCount !== null ? accessCount : cards.length;
  const membersCount = members.length > 0 ? members.length : (group?.memberCount || 0);

  return (
    <View style={styles.container}>
      {!isConnected && (
        <View style={styles.offlineBanner}>
          <Icon source="cloud-off-outline" size={16} color="#B91C1C" />
          <Text style={styles.offlineBannerText}>You are offline. Editing group, members, and sharing are disabled.</Text>
        </View>
      )}
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
              (!isConnected || (!isOwner && group?.contributionPermission === 'owner_only')) && styles.disabledBtn,
            ]}
            onPress={() => navigation.navigate('ShareToGroup', { groupId })}
            disabled={!isConnected || (!isOwner && group?.contributionPermission === 'owner_only')}
            activeOpacity={0.7}
          >
            <Icon source="share-variant" size={16} color="#FFFFFF" />
            <Text style={styles.actionBtnText}>Share cards</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.actionBtn,
              styles.unshareBtn,
              (!isConnected || userCardsInGroup.length === 0) && styles.disabledBtn,
            ]}
            onPress={() => navigation.navigate('UnshareFromGroup', { groupId })}
            disabled={!isConnected || userCardsInGroup.length === 0}
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
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              colors={['#111111']}
              tintColor="#111111"
            />
          }
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
                  style={[styles.emptyActionButton, !isConnected && { opacity: 0.5 }]}
                  onPress={() => navigation.navigate('ShareToGroup', { groupId })}
                  disabled={!isConnected}
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
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              colors={['#111111']}
              tintColor="#111111"
            />
          }
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
                    placeholder={isConnected ? "email@example.com" : "Connect to internet to add members"}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    editable={isConnected}
                    style={[styles.emailInput, !isConnected && { opacity: 0.6 }]}
                    placeholderTextColor="#9CA3AF"
                  />
                  <TouchableOpacity
                    style={[styles.addButton, (!isConnected || adding || !memberEmail.trim()) && { opacity: 0.5 }]}
                    onPress={handleAddMember}
                    disabled={adding || !isConnected || !memberEmail.trim()}
                  >
                    {adding ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text style={styles.addButtonText}>Add</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            ) : null
          }
          ListFooterComponent={
            isOwner ? (
              <TouchableOpacity
                style={[styles.deleteButton, !isConnected && { opacity: 0.5 }]}
                onPress={() => setDeleteVisible(true)}
                disabled={!isConnected}
                activeOpacity={0.8}
              >
                <Icon source="trash-can-outline" size={16} color="#DC2626" />
                <Text style={styles.deleteButtonText}>Delete group</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.leaveGroupButton, !isConnected && { opacity: 0.5 }]}
                onPress={() => setLeaveVisible(true)}
                disabled={!isConnected}
                activeOpacity={0.8}
              >
                <Icon source="exit-to-app" size={16} color="#DC2626" />
                <Text style={styles.leaveGroupButtonText}>Leave group</Text>
              </TouchableOpacity>
            )
          }
        />
      )}

      <Portal>
        <Dialog
          visible={leaveVisible}
          onDismiss={() => { if (!leaving) setLeaveVisible(false); }}
          style={styles.confirmDialog}
        >
          <View style={styles.confirmDialogContent}>
            <View style={styles.confirmHeader}>
              <View style={[styles.confirmIconContainer, { backgroundColor: '#FEE2E2' }]}>
                <Icon source="exit-to-app" size={20} color="#DC2626" />
              </View>
              <Text style={styles.confirmDialogTitle}>Leave group</Text>
            </View>
            <Text style={styles.confirmDialogMessage}>
              Are you sure you want to leave &quot;{group?.name || 'this group'}&quot;? You will lose access to all cards shared with this group, and any cards you shared here will be unshared.
            </Text>
            <View style={styles.confirmDialogActions}>
              <TouchableOpacity
                style={styles.confirmCancelBtn}
                onPress={() => setLeaveVisible(false)}
                disabled={leaving}
                activeOpacity={0.7}
              >
                <Text style={styles.confirmCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmActionBtn, { backgroundColor: '#DC2626' }, leaving && { opacity: 0.6 }]}
                onPress={handleLeaveGroup}
                disabled={leaving}
                activeOpacity={0.7}
              >
                {leaving && <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight: 6 }} />}
                <Text style={styles.confirmActionText}>{leaving ? 'Leaving...' : 'Leave group'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Dialog>

        <Dialog
          visible={deleteVisible}
          onDismiss={() => setDeleteVisible(false)}
          style={styles.confirmDialog}
        >
          <View style={styles.confirmDialogContent}>
            <View style={styles.confirmHeader}>
              <View style={[styles.confirmIconContainer, { backgroundColor: '#FEE2E2' }]}>
                <Icon source="trash-can-outline" size={20} color="#DC2626" />
              </View>
              <Text style={styles.confirmDialogTitle}>Delete group</Text>
            </View>
            <Text style={styles.confirmDialogMessage}>
              Are you sure you want to delete &quot;{group?.name || 'this group'}&quot;? This permanently removes the group and its sharing permissions. Original cards in your wallet are not deleted.
            </Text>
            <View style={styles.confirmDialogActions}>
              <TouchableOpacity
                style={styles.confirmCancelBtn}
                onPress={() => setDeleteVisible(false)}
                disabled={deleting}
                activeOpacity={0.7}
              >
                <Text style={styles.confirmCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmActionBtn, { backgroundColor: '#DC2626' }, deleting && { opacity: 0.6 }]}
                onPress={handleDeleteGroup}
                disabled={deleting}
                activeOpacity={0.7}
              >
                {deleting && <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight: 6 }} />}
                <Text style={styles.confirmActionText}>{deleting ? 'Deleting...' : 'Delete group'}</Text>
              </TouchableOpacity>
            </View>
          </View>
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
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderWidth: 1,
    marginHorizontal: 12,
    marginTop: 10,
    marginBottom: 0,
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
  headerEditBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    marginRight: 6,
  },
  headerEditText: {
    color: '#111111',
    fontWeight: '700',
    fontSize: 13,
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
    marginTop: 20,
    backgroundColor: '#FEE2E2',
    borderRadius: 8,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  deleteButtonText: {
    color: '#DC2626',
    fontWeight: '700',
    fontSize: 14,
  },
  leaveGroupButton: {
    marginTop: 20,
    backgroundColor: '#FEE2E2',
    borderRadius: 8,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  leaveGroupButtonText: {
    color: '#DC2626',
    fontWeight: '700',
    fontSize: 14,
  },
  headerLeaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    marginRight: 6,
  },
  headerLeaveText: {
    color: '#DC2626',
    fontWeight: '700',
    fontSize: 13,
  },
  youBadge: {
    backgroundColor: '#E5E7EB',
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 4,
  },
  youBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#374151',
  },
  memberLeaveRowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  memberLeaveRowText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#DC2626',
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
