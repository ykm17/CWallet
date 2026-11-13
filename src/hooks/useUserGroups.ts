import { useEffect, useMemo, useState } from 'react';
import auth from '@react-native-firebase/auth';
import { Group } from '../types/Types';
import { listenUserGroups } from '../services/groupService';
import { canShareToGroup } from '../services/sharingUtils';

export const useUserGroups = () => {
  const uid = auth().currentUser?.uid;
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const unsubscribe = listenUserGroups(
      (nextGroups) => {
        setGroups(nextGroups);
        setLoading(false);
        setError(null);
      },
      (listenError) => {
        console.error('Failed to load groups', listenError);
        setError('Unable to load groups.');
        setLoading(false);
      },
    );
    return unsubscribe;
  }, [uid]);

  const ownedGroups = useMemo(
    () => groups.filter((group) => group.ownerId === uid),
    [groups, uid],
  );
  const joinedGroups = useMemo(
    () => groups.filter((group) => group.ownerId !== uid),
    [groups, uid],
  );
  const shareableGroups = useMemo(
    () => groups.filter((group) => uid && canShareToGroup(group, uid)),
    [groups, uid],
  );

  return { groups, ownedGroups, joinedGroups, shareableGroups, loading, error };
};
