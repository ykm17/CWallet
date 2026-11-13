import React, { useContext, useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Alert } from './CustomAlert';
import { Button, Icon, Modal, Portal, Text } from 'react-native-paper';
import auth from '@react-native-firebase/auth';
import { Card, Group } from '../types/Types';
import { useUserGroups } from '../hooks/useUserGroups';
import { listenAccessForCard, syncCardGroupAccess } from '../services/sharingService';
import { canShareToGroup, contributionLabel } from '../services/sharingUtils';
import { BANK_DICTIONARY } from '../constants/Constants';
import { ConnectivityContext } from '../util/Connectivity';

interface ShareCardModalProps {
  visible: boolean;
  card: Card | null;
  onDismiss: () => void;
  onShared?: () => void;
}

const ShareCardModal: React.FC<ShareCardModalProps> = ({ visible, card, onDismiss, onShared }) => {
  const uid = auth().currentUser?.uid || '';
  const { isConnected } = useContext(ConnectivityContext);
  const { groups } = useUserGroups();
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [existingGroupIds, setExistingGroupIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible || !card?.key) {
      return;
    }
    return listenAccessForCard(card.key, (access) => {
      const ids = access.map((item) => item.groupId);
      setExistingGroupIds(ids);
      setSelectedGroupIds(ids);
    });
  }, [visible, card?.key]);

  const selectedGroups = useMemo(
    () => groups.filter((group) => selectedGroupIds.includes(group.groupId)),
    [groups, selectedGroupIds],
  );

  const hasChanges = useMemo(() => {
    const current = [...selectedGroupIds].sort().join(',');
    const initial = [...existingGroupIds].sort().join(',');
    return current !== initial;
  }, [selectedGroupIds, existingGroupIds]);

  const newGroups = useMemo(
    () => selectedGroups.filter((g) => !existingGroupIds.includes(g.groupId)),
    [selectedGroups, existingGroupIds],
  );

  const removedGroups = useMemo(
    () => groups.filter((g) => existingGroupIds.includes(g.groupId) && !selectedGroupIds.includes(g.groupId)),
    [groups, existingGroupIds, selectedGroupIds],
  );

  const toggleGroup = (group: Group) => {
    const alreadyShared = existingGroupIds.includes(group.groupId);
    const selected = selectedGroupIds.includes(group.groupId);
    if (!selected && !canShareToGroup(group, uid) && !alreadyShared) {
      Alert.alert('Sharing not allowed', `${group.name} is owner-controlled.`);
      return;
    }
    setSelectedGroupIds((prev) => (
      prev.includes(group.groupId)
        ? prev.filter((id) => id !== group.groupId)
        : [...prev, group.groupId]
    ));
  };

  const handleSave = async () => {
    if (!isConnected) {
      Alert.alert('Offline', 'You must be online to update card sharing.');
      return;
    }
    if (!card?.key) {
      return;
    }
    if (!hasChanges) {
      Alert.alert('No Changes', 'This card is already shared with the selected groups.');
      return;
    }

    let confirmMessage = '';
    if (selectedGroups.length === 0) {
      confirmMessage = 'Remove this card from all groups?';
    } else if (newGroups.length > 0 && removedGroups.length > 0) {
      confirmMessage = `Add access to: ${newGroups.map((g) => g.name).join(', ')}\nRemove access from: ${removedGroups.map((g) => g.name).join(', ')}`;
    } else if (newGroups.length > 0) {
      confirmMessage = `Share this card with: ${newGroups.map((g) => g.name).join(', ')}?`;
    } else {
      confirmMessage = `Remove access from: ${removedGroups.map((g) => g.name).join(', ')}?`;
    }

    Alert.alert(
      'Confirm Sharing',
      confirmMessage,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save',
          onPress: async () => {
            try {
              setSaving(true);
              await syncCardGroupAccess(card.key, selectedGroupIds);
              onShared?.();
              onDismiss();
            } catch (error: any) {
              Alert.alert('Could not update sharing', error.message || 'Please try again.');
            } finally {
              setSaving(false);
            }
          },
        },
      ],
    );
  };

  return (
    <Portal>
      <Modal visible={visible} onDismiss={onDismiss} contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Share card</Text>
            <Text style={styles.subtitle}>
              {card ? `${card.name || card.ownerName} · ${BANK_DICTIONARY[card.bankName] || card.bankName}` : ''}
            </Text>
          </View>
          <TouchableOpacity onPress={onDismiss}>
            <Icon source="close" size={20} color="#555555" />
          </TouchableOpacity>
        </View>

        {!isConnected && (
          <View style={styles.offlineBanner}>
            <Icon source="cloud-off-outline" size={16} color="#B91C1C" />
            <Text style={styles.offlineBannerText}>You are offline. Updating card sharing is disabled.</Text>
          </View>
        )}

        <Text style={styles.help}>
          Select every group that should be able to view this card. Sharing never copies the card or changes ownership.
        </Text>

        <ScrollView style={styles.list}>
          {groups.length === 0 ? (
            <Text style={styles.empty}>Join or create a group first.</Text>
          ) : groups.map((group) => {
            const selected = selectedGroupIds.includes(group.groupId);
            const alreadyShared = existingGroupIds.includes(group.groupId);
            const allowed = canShareToGroup(group, uid) || alreadyShared;
            return (
              <TouchableOpacity
                key={group.groupId}
                style={[styles.row, selected && styles.rowSelected, !allowed && styles.rowDisabled]}
                onPress={() => toggleGroup(group)}
              >
                <Icon
                  source={selected ? 'checkbox-marked' : 'checkbox-blank-outline'}
                  size={22}
                  color={allowed ? '#111111' : '#D1D5DB'}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{group.name}</Text>
                  <Text style={styles.rowSubtitle}>
                    {contributionLabel(group.contributionPermission)}
                    {alreadyShared ? ' · Has access' : ''}
                    {group.ownerId === uid ? ' · Your group' : ''}
                    {!canShareToGroup(group, uid) && !alreadyShared ? ' · Owner-controlled' : ''}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={styles.confirmBox}>
          {hasChanges ? (
            <Text style={styles.confirmText}>
              {newGroups.length > 0 ? `Adding access: ${newGroups.map((g) => g.name).join(', ')}` : ''}
              {newGroups.length > 0 && removedGroups.length > 0 ? '\n' : ''}
              {removedGroups.length > 0 ? `Removing access: ${removedGroups.map((g) => g.name).join(', ')}` : ''}
            </Text>
          ) : (
            <Text style={[styles.confirmText, { color: '#6B7280' }]}>
              {selectedGroups.length > 0
                ? `Already shared with: ${selectedGroups.map((g) => g.name).join(', ')}`
                : 'Select groups to share this card with.'}
            </Text>
          )}
        </View>

        <Button
          mode="contained"
          onPress={handleSave}
          loading={saving}
          disabled={saving || !hasChanges || !isConnected}
          style={[styles.saveButton, (!hasChanges || !isConnected) && { opacity: 0.55 }]}
          labelStyle={{ color: '#FFFFFF', fontWeight: '700' }}
        >
          {!isConnected
            ? 'Offline (Cannot save)'
            : hasChanges
            ? 'Save sharing'
            : 'No changes to save'}
        </Button>
      </Modal>
    </Portal>
  );
};

export default ShareCardModal;

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#F8F9FA',
    marginHorizontal: 16,
    borderRadius: 16,
    padding: 16,
    maxHeight: '85%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
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
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111111',
  },
  subtitle: {
    marginTop: 2,
    color: '#6B7280',
    fontSize: 12,
  },
  help: {
    color: '#6B7280',
    fontSize: 13,
    marginBottom: 12,
  },
  list: {
    maxHeight: 320,
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
  rowTitle: {
    fontWeight: '700',
    color: '#111111',
  },
  rowSubtitle: {
    color: '#6B7280',
    fontSize: 12,
    marginTop: 2,
  },
  empty: {
    color: '#6B7280',
    paddingVertical: 16,
    textAlign: 'center',
  },
  confirmBox: {
    marginTop: 8,
    marginBottom: 12,
  },
  confirmText: {
    fontWeight: '600',
    color: '#111111',
  },
  saveButton: {
    backgroundColor: '#111111',
    borderRadius: 8,
  },
});
