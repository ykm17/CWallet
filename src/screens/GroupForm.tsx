import React, { useContext, useEffect, useState, useRef } from 'react';
import { View, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { Alert } from '../components/CustomAlert';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, HelperText, Icon, SegmentedButtons, Text, TextInput } from 'react-native-paper';
import { RootStackParamList } from '../App';
import { CONTRIBUTION } from '../constants/Firestore';
import { ContributionPermission } from '../types/Types';
import { createGroup, fetchGroup, updateGroup } from '../services/groupService';
import { ConnectivityContext } from '../util/Connectivity';

type Props = NativeStackScreenProps<RootStackParamList, 'GroupForm'>;

const GroupForm: React.FC<Props> = ({ navigation, route }) => {
  const groupId = route.params?.groupId;
  const isEdit = Boolean(groupId);
  const { isConnected } = useContext(ConnectivityContext);
  const [name, setName] = useState('');
  const [permission, setPermission] = useState<ContributionPermission>(CONTRIBUTION.OPEN);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(Boolean(groupId));

  useEffect(() => {
    navigation.setOptions({
      title: isEdit ? 'Edit Group' : 'Create Group',
      headerTitleAlign: 'center',
      headerStyle: { backgroundColor: '#F4F5F7' },
    });
  }, [isEdit, navigation]);

  useEffect(() => {
    if (!groupId) {
      return;
    }
    fetchGroup(groupId)
      .then((group) => {
        setName(group.name);
        setPermission(group.contributionPermission);
      })
      .catch((error) => {
        Alert.alert('Unable to load group', error.message);
        navigation.goBack();
      })
      .finally(() => setLoading(false));
  }, [groupId, navigation]);

  const savingRef = useRef(false);

  const handleSave = async () => {
    if (saving || savingRef.current) return;
    if (!isConnected) {
      Alert.alert('Offline', 'You must be online to create or update a group.');
      return;
    }
    if (!name.trim()) {
      return;
    }
    try {
      savingRef.current = true;
      setSaving(true);
      if (groupId) {
        await updateGroup(groupId, { name, contributionPermission: permission });
        navigation.goBack();
      } else {
        const createdId = await createGroup(name, permission);
        navigation.replace('GroupDetails', { groupId: createdId });
      }
    } catch (error: any) {
      Alert.alert('Could not save group', error.message || 'Please try again.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content}>
        {!isConnected && (
          <View style={styles.offlineBanner}>
            <Icon source="cloud-off-outline" size={16} color="#B91C1C" />
            <Text style={styles.offlineBannerText}>You are offline. Reconnect to save or update groups.</Text>
          </View>
        )}
        <Text style={styles.heading}>{isEdit ? 'Update group details' : 'New group'}</Text>
        <Text style={styles.subheading}>
          Groups control who can view shared cards. They do not copy cards.
        </Text>

        <TextInput
          label="Group name"
          value={name}
          onChangeText={setName}
          mode="outlined"
          placeholder="Family, Friends, Work..."
          style={styles.input}
          editable={isConnected}
        />
        {!name.trim() && (
          <HelperText type="info">Choose a name. Duplicate names are allowed across users.</HelperText>
        )}

        <Text style={styles.sectionTitle}>Contribution permission</Text>
        <SegmentedButtons
          value={permission}
          onValueChange={(value) => setPermission(value as ContributionPermission)}
          buttons={[
            { value: CONTRIBUTION.OPEN, label: 'Open' },
            { value: CONTRIBUTION.OWNER_ONLY, label: 'Owner only' },
          ]}
        />
        <Text style={styles.helpText}>
          {permission === CONTRIBUTION.OPEN
            ? 'All members can share their own cards with this group.'
            : 'Only you can share cards with this group. Existing shared cards stay visible.'}
        </Text>

        <Button
          mode="contained"
          onPress={handleSave}
          loading={saving || loading}
          disabled={!name.trim() || saving || loading || !isConnected}
          style={styles.saveButton}
          labelStyle={styles.saveLabel}
        >
          {saving ? (isEdit ? 'Saving changes...' : 'Creating group...') : isEdit ? 'Save changes' : 'Create group'}
        </Button>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

export default GroupForm;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F4F5F7',
  },
  content: {
    padding: 16,
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderWidth: 1,
    marginBottom: 16,
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
  heading: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111111',
  },
  subheading: {
    marginTop: 6,
    marginBottom: 18,
    color: '#6B7280',
    fontSize: 13,
  },
  input: {
    backgroundColor: '#FFFFFF',
  },
  sectionTitle: {
    marginTop: 20,
    marginBottom: 10,
    fontWeight: '700',
    color: '#111111',
  },
  helpText: {
    marginTop: 10,
    color: '#6B7280',
    fontSize: 13,
    lineHeight: 18,
  },
  saveButton: {
    marginTop: 28,
    backgroundColor: '#111111',
    borderRadius: 8,
  },
  saveLabel: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
});
