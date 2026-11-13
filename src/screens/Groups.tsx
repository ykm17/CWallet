import React, { useEffect } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { FAB, Icon, Text } from 'react-native-paper';
import { RootStackParamList } from '../App';
import { Group } from '../types/Types';
import { useUserGroups } from '../hooks/useUserGroups';
import { contributionLabel } from '../services/sharingUtils';
import auth from '@react-native-firebase/auth';

type Props = NativeStackScreenProps<RootStackParamList, 'Groups'>;

const Groups: React.FC<Props> = ({ navigation }) => {
  const uid = auth().currentUser?.uid;
  const { groups, loading, error } = useUserGroups();

  useEffect(() => {
    navigation.setOptions({
      title: 'Groups',
      headerTitleAlign: 'center',
      headerStyle: { backgroundColor: '#F4F5F7' },
    });
  }, [navigation]);

  const renderGroup = ({ item }: { item: Group }) => {
    const isOwner = item.ownerId === uid;
    return (
      <TouchableOpacity
        style={styles.groupCard}
        activeOpacity={0.8}
        onPress={() => navigation.navigate('GroupDetails', { groupId: item.groupId })}
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
      <FlatList
        data={groups}
        keyExtractor={(item) => item.groupId}
        renderItem={renderGroup}
        contentContainerStyle={groups.length === 0 ? styles.emptyContainer : styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Icon source="account-group-outline" size={48} color="#9CA3AF" />
            <Text style={styles.emptyTitle}>{loading ? 'Loading groups' : 'No groups yet'}</Text>
            <Text style={styles.emptySubtitle}>
              {error || 'Create a group to share cards with family, friends, or work.'}
            </Text>
          </View>
        }
      />
      <FAB
        icon="plus"
        style={styles.fab}
        color="white"
        onPress={() => navigation.navigate('GroupForm', {})}
      />
    </View>
  );
};

export default Groups;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F4F5F7',
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
    borderRadius: 20,
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
    borderRadius: 10,
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
    borderRadius: 30,
  },
});
