import React, { useContext, useEffect, useState } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { Alert } from '../components/CustomAlert';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Dialog, FAB, Icon, Portal, Text } from 'react-native-paper';
import { RootStackParamList } from '../App';
import { Group } from '../types/Types';
import { useUserGroups } from '../hooks/useUserGroups';
import { contributionLabel } from '../services/sharingUtils';
import { activatePendingMembershipsForUser, leaveGroup } from '../services/groupService';
import { ConnectivityContext } from '../util/Connectivity';
import auth from '@react-native-firebase/auth';

type Props = NativeStackScreenProps<RootStackParamList, 'Groups'>;

const Groups: React.FC<Props> = ({ navigation }) => {
  const uid = auth().currentUser?.uid;
  const { isConnected } = useContext(ConnectivityContext);
  const { groups, loading, error } = useUserGroups();
  const [leaveTarget, setLeaveTarget] = useState<Group | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      if (isConnected) {
        await activatePendingMembershipsForUser();
      }
    } catch (e) {
      console.error('Failed to refresh groups:', e);
    } finally {
      setTimeout(() => setRefreshing(false), 400);
    }
  };

  useEffect(() => {
    navigation.setOptions({
      title: 'Groups',
      headerTitleAlign: 'center',
      headerStyle: { backgroundColor: '#F4F5F7' },
    });
  }, [navigation]);

  const handleConfirmLeaveGroup = async () => {
    if (!leaveTarget) return;
    if (!isConnected) {
      Alert.alert('Offline', 'You must be online to leave a group.');
      return;
    }
    try {
      setLeaving(true);
      await leaveGroup(leaveTarget.groupId);
      setLeaveTarget(null);
    } catch (err: any) {
      Alert.alert('Could not leave group', err.message || 'Please try again.');
    } finally {
      setLeaving(false);
    }
  };

  const renderGroup = ({ item }: { item: Group }) => {
    const isOwner = item.ownerId === uid;
    return (
      <TouchableOpacity
        style={styles.groupCard}
        activeOpacity={0.8}
        onPress={() => navigation.navigate('GroupDetails', { groupId: item.groupId })}
        onLongPress={() => {
          if (!isOwner) {
            if (!isConnected) {
              Alert.alert('Offline', 'You must be online to leave a group.');
              return;
            }
            setLeaveTarget(item);
          }
        }}
      >
        <View style={styles.groupIcon}>
          <Icon source="account-group" size={22} color="#FFFFFF" />
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.titleRow}>
            <Text style={styles.groupName} numberOfLines={1}>{item.name}</Text>
            <View style={[styles.badge, isOwner ? styles.ownerBadge : styles.memberBadge]}>
              <Text style={[styles.badgeText, isOwner ? styles.ownerBadgeText : styles.memberBadgeText]}>
                {isOwner ? 'Owner' : 'Member'}
              </Text>
            </View>
          </View>
          <Text style={styles.metaText}>
            {item.memberCount} {item.memberCount === 1 ? 'member' : 'members'} · {contributionLabel(item.contributionPermission)}
          </Text>
        </View>
        <Icon source="chevron-right" size={22} color="#9CA3AF" />
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {!isConnected && (
        <View style={styles.offlineBanner}>
          <Icon source="cloud-off-outline" size={16} color="#B91C1C" />
          <Text style={styles.offlineBannerText}>You are offline. Creating or leaving groups is disabled.</Text>
        </View>
      )}
      <FlatList
        data={groups}
        keyExtractor={(item) => item.groupId}
        renderItem={renderGroup}
        contentContainerStyle={groups.length === 0 ? styles.emptyContainer : styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            colors={['#111111']}
            tintColor="#111111"
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            {loading ? (
              <>
                <ActivityIndicator size="small" color="#111111" style={{ marginBottom: 12 }} />
                <Text style={styles.emptyTitle}>Loading groups...</Text>
                <Text style={styles.emptySubtitle}>Fetching your groups</Text>
              </>
            ) : (
              <>
                <Icon source="account-group-outline" size={48} color="#9CA3AF" />
                <Text style={styles.emptyTitle}>No groups yet</Text>
                <Text style={styles.emptySubtitle}>
                  {error || 'Create a group to share cards with family, friends, or work.'}
                </Text>
              </>
            )}
          </View>
        }
      />
      <FAB
        visible={isConnected}
        icon="plus"
        style={styles.fab}
        color="white"
        onPress={() => navigation.navigate('GroupForm', {})}
      />

      <Portal>
        <Dialog
          visible={Boolean(leaveTarget)}
          onDismiss={() => { if (!leaving) setLeaveTarget(null); }}
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
              Are you sure you want to leave &quot;{leaveTarget?.name || 'this group'}&quot;? You will lose access to all cards shared with this group, and any cards you shared here will be unshared.
            </Text>
            <View style={styles.confirmDialogActions}>
              <TouchableOpacity
                style={styles.confirmCancelBtn}
                onPress={() => setLeaveTarget(null)}
                disabled={leaving}
                activeOpacity={0.7}
              >
                <Text style={styles.confirmCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmActionBtn, { backgroundColor: '#DC2626' }]}
                onPress={handleConfirmLeaveGroup}
                disabled={leaving}
                activeOpacity={0.7}
              >
                <Text style={styles.confirmActionText}>{leaving ? 'Leaving...' : 'Leave group'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Dialog>
      </Portal>
    </View>
  );
};

export default Groups;

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
    marginBottom: 4,
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
  listContent: {
    padding: 12,
    paddingBottom: 100,
  },
  emptyContainer: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  groupCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  groupIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#1B1B1B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  groupName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111111',
    flexShrink: 1,
  },
  metaText: {
    marginTop: 4,
    fontSize: 12,
    color: '#6B7280',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  ownerBadge: {
    backgroundColor: '#111111',
  },
  memberBadge: {
    backgroundColor: '#E5E7EB',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  ownerBadgeText: {
    color: '#FFFFFF',
  },
  memberBadgeText: {
    color: '#374151',
  },
  emptyState: {
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyTitle: {
    marginTop: 12,
    fontSize: 16,
    fontWeight: '700',
    color: '#4B5563',
  },
  emptySubtitle: {
    marginTop: 6,
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
  },
  fab: {
    backgroundColor: '#1B1B1B',
    position: 'absolute',
    right: 16,
    bottom: 20,
    borderRadius: 10,
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
