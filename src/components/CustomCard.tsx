import { StyleSheet, TouchableOpacity, TouchableWithoutFeedback, View, ScrollView, ActivityIndicator, Platform } from 'react-native'
import React, { useContext, useState, useRef } from 'react'
import { Alert } from './CustomAlert'
import { Card } from '../types/Types'
import Clipboard from '@react-native-clipboard/clipboard'
import { convertLongNumberToText, formatCardLimit, maskCardNumber, removeSpaceFromString } from '../util/Utils'
import { BANK_COLORS, BANK_DICTIONARY, CARD_NETWORKS, CARD_TYPES, ENV } from '../constants/Constants'
import { Button, Dialog, Icon, Portal, Text, Tooltip } from 'react-native-paper'
import auth from '@react-native-firebase/auth';
import { ConnectivityContext } from '../util/Connectivity'
import { usePrivacy } from '../util/PrivacyContext'
import { deleteOwnedCard } from '../services/cardService'
import { showCardOverlay } from '../services/cardOverlayService'
import BankLogo from './BankLogo'

interface CardProps {
  cardDetails: Card,
  onCardLongPress?: (card: Card) => void,
  onCardEdit?: (card: Card) => void,
  onShare?: (card: Card) => void,
  onUnshare?: (card: Card) => void,
  selectionMode?: boolean,
  isSelected?: boolean,
  onToggleSelect?: (card: Card) => void,
  showYourCardLabel?: boolean,
}

const CustomCard: React.FC<CardProps> = ({
  cardDetails,
  onCardLongPress,
  onCardEdit,
  onShare,
  onUnshare,
  selectionMode,
  isSelected,
  onToggleSelect,
  showYourCardLabel,
}) => {
  const [visible, setVisible] = useState(false);
  const [sharedGroupsVisible, setSharedGroupsVisible] = useState(false);
  const [copiedField, setCopiedField] = useState<'number' | 'card' | null>(null);
  const isConnected = useContext(ConnectivityContext).isConnected;
  const { isPrivacyMode } = usePrivacy();

  const showDialog = () => setVisible(true);
  const hideDialog = () => setVisible(false);
  const hideSharedGroups = () => setSharedGroupsVisible(false);

  const handleEdit = () => {
    if (!isConnected) {
      Alert.alert('Offline', 'You must be online to edit cards.');
      return;
    }
    if (onCardEdit) {
      onCardEdit(cardDetails);
    } else if (onCardLongPress) {
      onCardLongPress(cardDetails);
    }
  };

  const copyNumber = () => {
    Clipboard.setString(removeSpaceFromString(cardDetails.number));
    setCopiedField('number');
    setTimeout(() => {
      setCopiedField(null);
    }, 2000);

    // Show floating overlay with expiry and CVV and move app to background
    showCardOverlay(cardDetails).catch((err) => {
      console.warn('Could not launch card overlay:', err);
    });
  };

  const copyWholeCard = () => {
    Clipboard.setString(getCardCopyText());
    setCopiedField('card');
    setTimeout(() => {
      setCopiedField(null);
    }, 2000);
  };

  const isOwner = cardDetails.email === auth().currentUser?.email
    || cardDetails.ownerId === auth().currentUser?.uid;

  const handlePress = () => {
    if (selectionMode) {
      onToggleSelect?.(cardDetails);
    }
  };

  const [deleting, setDeleting] = useState(false);
  const deletingRef = useRef(false);

  const handleDelete = async () => {
    if (deletingRef.current || deleting) return;
    if (!isConnected) {
      Alert.alert('Offline', 'You must be online to delete cards.');
      hideDialog();
      return;
    }
    try {
      deletingRef.current = true;
      setDeleting(true);
      await deleteOwnedCard(cardDetails.key);
      hideDialog();
    } catch (error) {
      console.error('Error deleting card:', error);
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  };

  const getNetworkLabel = (network?: string) => {
    if (!network) return '';
    if (network === 'AMEX') return 'Amex';
    if (network === 'DINERS') return 'Diners';
    return CARD_NETWORKS[network] || network;
  };

  const networkLabel = getNetworkLabel(cardDetails.network);
  const cardTypeLabel = cardDetails.cardType
    ? (CARD_TYPES[cardDetails.cardType] || cardDetails.cardType)
    : '';
  const badgeLabel = [networkLabel, cardTypeLabel].filter(Boolean).join(' • ');

  const isDebitOrPluxee = cardDetails.cardType === 'DEBIT' || cardDetails.cardType === 'PREPAID' || cardDetails.bankName === 'PX';
  const limitFormatted = isDebitOrPluxee ? '' : formatCardLimit(cardDetails.limit);

  const getCardCopyText = () => {
    const lines = [
      `Bank Name: ${BANK_DICTIONARY[cardDetails.bankName] || cardDetails.bankName}`,
      networkLabel ? `Network: ${networkLabel}` : null,
      cardTypeLabel ? `Type: ${cardTypeLabel}` : null,
      `Name: ${cardDetails.ownerName}`,
      cardDetails.name ? `Card Label: ${cardDetails.name}` : null,
      `Card No: ${cardDetails.number}`,
      `Exp: ${cardDetails.month}/${cardDetails.year}`,
      `Cvv: ${cardDetails.cvv}`,
      (!isDebitOrPluxee && cardDetails.limit) ? `Limit: ${cardDetails.limit}` : null,
    ].filter(Boolean);
    return lines.join('\n');
  };

  const groupNames = (cardDetails.accessGroupNames && cardDetails.accessGroupNames.length > 0)
    ? cardDetails.accessGroupNames
    : (cardDetails.sharedGroupIds || []).map((_, i) => `Group ${i + 1}`);

  const sharedGroupCount = cardDetails.sharedGroupIds?.length || 0;
  const sharedPeople = cardDetails.sharedWithUsers || [];
  const sharedPeopleCount = sharedPeople.length;
  const totalSharedCount = sharedGroupCount + sharedPeopleCount;

  const accessGroups = cardDetails.accessGroupNames || [];
  const accessUsers = cardDetails.accessUserNames || [];
  const recipientSourcesCount = accessGroups.length + accessUsers.length;

  const hasLeftElement = isOwner
    ? totalSharedCount > 0
    : (recipientSourcesCount > 0 || Boolean(cardDetails.ownerName));

  return (
    <TouchableWithoutFeedback
      onPress={handlePress}
      onLongPress={() => {
        if (selectionMode) {
          onToggleSelect?.(cardDetails);
          return;
        }
        onCardLongPress?.(cardDetails);
      }}
    >

      <View style={[
        styles.container,
        { backgroundColor: BANK_COLORS[cardDetails.bankName] || '#1B1B1B' },
        isSelected && styles.selectedContainer,
      ]}>
        {/* Subtle Ambient Sheen Highlights for physical depth & glow */}
        <View pointerEvents="none" style={styles.cardSheenTop} />
        <View pointerEvents="none" style={styles.cardSheenBottom} />

        {/* Row 1: Bank Name & Brand / Tier Tags (Left) + Action Pill (Right) */}
        <View style={styles.headerRow}>
          <View style={styles.bankInfoContainer}>
            <View style={styles.bankHeaderRow}>
              <BankLogo bankKey={cardDetails.bankName} size={22} withCardBadge style={{ marginRight: 8 }} />
              <Text style={styles.bankNameText} numberOfLines={1}>
                {BANK_DICTIONARY[cardDetails.bankName] || cardDetails.bankName || 'BANK CARD'}
              </Text>
            </View>
            <View style={styles.badgeRow}>
              {showYourCardLabel && isOwner ? (
                <View style={styles.yourCardBadge}>
                  <Text style={styles.yourCardText}>YOUR CARD</Text>
                </View>
              ) : null}
              {cardDetails.name ? (
                <View style={styles.cardTierBadge}>
                  <Text style={styles.cardTierText} numberOfLines={1}>{cardDetails.name}</Text>
                </View>
              ) : null}
            </View>
          </View>

          {isConnected && isOwner && !selectionMode ? (
            <View style={styles.actionPill}>
              {onShare && (
                <TouchableOpacity
                  style={styles.actionIconBtn}
                  onPress={() => onShare(cardDetails)}
                  hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                >
                  <Icon source="share-variant" color="#FFFFFF" size={14} />
                </TouchableOpacity>
              )}
              {onUnshare && totalSharedCount > 0 && (
                <TouchableOpacity
                  style={styles.actionIconBtn}
                  onPress={() => onUnshare(cardDetails)}
                  hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                >
                  <Icon source="share-off" color="#FFFFFF" size={14} />
                </TouchableOpacity>
              )}
              {onCardEdit && (
                <TouchableOpacity
                  style={styles.actionIconBtn}
                  onPress={handleEdit}
                  hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                >
                  <Icon source="pencil" color="#FFFFFF" size={14} />
                </TouchableOpacity>
              )}
              {onCardEdit && (
                <TouchableOpacity
                  style={styles.actionIconBtn}
                  onPress={showDialog}
                  hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                >
                  <Icon source="delete-outline" color="#FFFFFF" size={14} />
                </TouchableOpacity>
              )}
            </View>
          ) : selectionMode ? (
            <View style={styles.selectionCheckWrap}>
              <Icon
                source={isSelected ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'}
                color="#FFFFFF"
                size={22}
              />
            </View>
          ) : null}
        </View>

        {/* Row 2: EMV Chip & Contactless wave (Left) + Optional Card Limit (Right) */}
        <View style={styles.chipRow}>
          <View style={styles.chipAndWaveContainer}>
            <View style={styles.chipWrapper}>
              <Icon source="credit-card-chip" color="rgba(255, 255, 255, 0.9)" size={20} />
            </View>
            <View style={styles.contactlessWrapper}>
              <Icon source="contactless-payment" color="rgba(255, 255, 255, 0.75)" size={16} />
            </View>
          </View>

          {limitFormatted ? (
            <View style={styles.limitContainer}>
              <Text style={styles.cardMicroLabel}>LIMIT</Text>
              <Text style={styles.limitValueText}>
                {isPrivacyMode ? '••••••' : limitFormatted}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Row 3: Card Number with Quick Copy Pill */}
        <View style={styles.cardNumberRow}>
          <TouchableWithoutFeedback onLongPress={copyNumber}>
            <Text style={styles.cardNumberText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
              {isPrivacyMode ? maskCardNumber(cardDetails.number) : cardDetails.number}
            </Text>
          </TouchableWithoutFeedback>
          <TouchableOpacity
            style={[styles.copyNumberBtn, copiedField === 'number' && styles.copyBtnActive]}
            onPress={copyNumber}
            activeOpacity={0.7}
          >
            <Icon
              source={copiedField === 'number' ? 'check' : 'content-copy'}
              color="#FFFFFF"
              size={10}
            />
            <Text style={styles.copyBtnText}>
              {copiedField === 'number' ? 'Copied' : 'Copy'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Row 4: Cardholder Name (Left), Expiry & CVV (Center), Network Tag (Right) */}
        <View style={styles.detailsRow}>
          <View style={styles.cardholderSection}>
            <Text style={styles.cardMicroLabel}>CARDHOLDER</Text>
            <Text style={styles.cardholderText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
              {cardDetails.ownerName}
            </Text>
          </View>

          <View style={styles.expiryCvvSection}>
            <View style={styles.expiryCol}>
              <Text style={styles.cardMicroLabel}>EXPIRES</Text>
              <Text style={styles.cardDetailValText}>
                {isPrivacyMode ? '••/••' : `${cardDetails.month}/${cardDetails.year}`}
              </Text>
            </View>
            <View style={styles.cvvCol}>
              <Text style={styles.cardMicroLabel}>CVV</Text>
              <Text style={styles.cardDetailValText}>
                {isPrivacyMode ? '•••' : cardDetails.cvv}
              </Text>
            </View>
          </View>

          {badgeLabel ? (
            <View style={styles.networkTagContainer}>
              <Text style={styles.networkTagText}>{badgeLabel}</Text>
            </View>
          ) : null}
        </View>

        {/* Footer Row: Shared status or via group on left, Copy Whole Card on right */}
        <View style={styles.cardFooterDivider} />
        <View style={styles.cardBottomRow}>
          {hasLeftElement ? (
            isOwner ? (
              <TouchableOpacity
                style={styles.sharedBadgeBtn}
                onPress={() => setSharedGroupsVisible(true)}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Icon source="account-group" size={11.5} color="rgba(255, 255, 255, 0.9)" />
                <Text style={styles.sharedBadgeText}>Shared ({totalSharedCount})</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.sharedBadgeBtn}
                onPress={() => setSharedGroupsVisible(true)}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Icon source="share-variant" size={11} color="rgba(255, 255, 255, 0.9)" />
                <Text style={styles.sharedBadgeText}>
                  via ({recipientSourcesCount || 1})
                </Text>
              </TouchableOpacity>
            )
          ) : (
            <View style={{ flex: 1 }} />
          )}

          <TouchableOpacity
            style={[
              styles.copyCardBtn,
              copiedField === 'card' && styles.copyBtnActive,
            ]}
            onPress={copyWholeCard}
            activeOpacity={0.7}
          >
            <Icon
              source={copiedField === 'card' ? 'check' : 'content-copy'}
              color="#FFFFFF"
              size={10}
            />
            <Text style={styles.copyBtnText}>
              {copiedField === 'card' ? 'Copied' : 'Copy Card'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Modern Delete Confirmation Dialog */}
        <Portal>
          {/* Shared Groups Popup Dialog */}
          <Dialog
            visible={sharedGroupsVisible}
            onDismiss={hideSharedGroups}
            style={styles.groupsDialog}
          >
            <View style={styles.groupsDialogBody}>
              <View style={styles.groupsDialogHeader}>
                <View style={styles.groupsDialogIconContainer}>
                  <Icon source={isOwner ? "account-group" : "share-variant"} size={20} color="#111111" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.groupsDialogTitle}>
                    {isOwner ? "Shared Groups" : "Card Shared Via"}
                  </Text>
                  <Text style={styles.groupsDialogSubtitle} numberOfLines={1}>
                    {cardDetails.ownerName ? `${cardDetails.ownerName} • ` : ''}{BANK_DICTIONARY[cardDetails.bankName] || cardDetails.bankName || 'Card'}
                  </Text>
                </View>
              </View>

              <Text style={styles.groupsDialogMessage}>
                {isOwner
                  ? "This card is currently shared with:"
                  : "This card is shared with you via:"}
              </Text>

              <ScrollView style={styles.groupsListContainer} bounces={false}>
                {isOwner ? (
                  <>
                    {groupNames.length > 0 && (
                      <View style={{ marginBottom: 8 }}>
                        <Text style={{ fontSize: 11, fontWeight: '700', color: '#6B7280', marginBottom: 4, textTransform: 'uppercase' }}>
                          Groups ({groupNames.length})
                        </Text>
                        {groupNames.map((name, index) => (
                          <View key={`grp-${name}-${index}`} style={styles.groupItemRow}>
                            <View style={styles.groupItemIcon}>
                              <Icon source="account-group-outline" size={15} color="#FFFFFF" />
                            </View>
                            <Text style={styles.groupItemText} numberOfLines={1}>
                              {name}
                            </Text>
                          </View>
                        ))}
                      </View>
                    )}

                    {sharedPeople.length > 0 && (
                      <View style={{ marginBottom: 4 }}>
                        <Text style={{ fontSize: 11, fontWeight: '700', color: '#6B7280', marginBottom: 4, textTransform: 'uppercase' }}>
                          People ({sharedPeople.length})
                        </Text>
                        {sharedPeople.map((person, index) => (
                          <View key={`usr-${person.email || person.appleUserId || index}`} style={styles.groupItemRow}>
                            <View style={[styles.groupItemIcon, { backgroundColor: '#3B82F6' }]}>
                              <Icon source="account-outline" size={15} color="#FFFFFF" />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.groupItemText} numberOfLines={1}>
                                {person.displayName || person.email || person.appleUserId}
                              </Text>
                              {person.email && person.displayName && (
                                <Text style={{ fontSize: 11, color: '#9CA3AF' }} numberOfLines={1}>
                                  {person.email}
                                </Text>
                              )}
                            </View>
                          </View>
                        ))}
                      </View>
                    )}
                  </>
                ) : (
                  <>
                    {accessGroups.length > 0 && (
                      <View style={{ marginBottom: 8 }}>
                        <Text style={{ fontSize: 11, fontWeight: '700', color: '#6B7280', marginBottom: 4, textTransform: 'uppercase' }}>
                          Groups ({accessGroups.length})
                        </Text>
                        {accessGroups.map((name, index) => (
                          <View key={`acc-grp-${name}-${index}`} style={styles.groupItemRow}>
                            <View style={styles.groupItemIcon}>
                              <Icon source="account-group-outline" size={15} color="#FFFFFF" />
                            </View>
                            <Text style={styles.groupItemText} numberOfLines={1}>
                              {name}
                            </Text>
                          </View>
                        ))}
                      </View>
                    )}

                    {accessUsers.length > 0 && (
                      <View style={{ marginBottom: 4 }}>
                        <Text style={{ fontSize: 11, fontWeight: '700', color: '#6B7280', marginBottom: 4, textTransform: 'uppercase' }}>
                          Shared Directly By ({accessUsers.length})
                        </Text>
                        {accessUsers.map((name, index) => (
                          <View key={`acc-usr-${name}-${index}`} style={styles.groupItemRow}>
                            <View style={[styles.groupItemIcon, { backgroundColor: '#3B82F6' }]}>
                              <Icon source="account-outline" size={15} color="#FFFFFF" />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.groupItemText} numberOfLines={1}>
                                {name}
                              </Text>
                            </View>
                          </View>
                        ))}
                      </View>
                    )}

                    {accessGroups.length === 0 && accessUsers.length === 0 && (
                      <View style={styles.groupItemRow}>
                        <View style={[styles.groupItemIcon, { backgroundColor: '#3B82F6' }]}>
                          <Icon source="account-outline" size={15} color="#FFFFFF" />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.groupItemText} numberOfLines={1}>
                            {cardDetails.sharedByInfo?.name || cardDetails.ownerName || 'Card Owner'}
                          </Text>
                          {cardDetails.sharedByInfo?.email && (
                            <Text style={{ fontSize: 11, color: '#9CA3AF' }} numberOfLines={1}>
                              {cardDetails.sharedByInfo.email}
                            </Text>
                          )}
                        </View>
                      </View>
                    )}
                  </>
                )}
              </ScrollView>

              <TouchableOpacity
                style={styles.groupsDialogCloseBtn}
                onPress={hideSharedGroups}
                activeOpacity={0.7}
              >
                <Text style={styles.groupsDialogCloseText}>Close</Text>
              </TouchableOpacity>
            </View>
          </Dialog>

          <Dialog
            visible={visible}
            onDismiss={hideDialog}
            style={styles.deleteDialog}
          >
            <View style={styles.deleteDialogBody}>
              <View style={styles.deleteTitleRow}>
                <Icon source="trash-can-outline" size={20} color="#D32F2F" />
                <Text style={styles.deleteDialogTitle}>Delete Card</Text>
              </View>
              <Text style={styles.deleteDialogMessage}>
                Are you sure you want to remove this card? This action cannot be undone.
              </Text>

              {/* Styled Mini Card Preview */}
              <View
                style={[
                  styles.deleteCardPreview,
                  { backgroundColor: BANK_COLORS[cardDetails.bankName] || '#1B1B1B' },
                ]}
              >
                <View style={styles.deleteCardPreviewHeader}>
                  <Text style={styles.deleteCardPreviewBank} numberOfLines={1}>
                    {BANK_DICTIONARY[cardDetails.bankName]}
                  </Text>
                  {badgeLabel ? (
                    <Text style={styles.deleteCardPreviewBadge} numberOfLines={1}>
                      {badgeLabel}
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.deleteCardPreviewNumber}>
                  {isPrivacyMode ? maskCardNumber(cardDetails.number) : cardDetails.number}
                </Text>
                <Text style={styles.deleteCardPreviewOwner} numberOfLines={1}>
                  {cardDetails.ownerName}
                </Text>
              </View>

              <View style={styles.deleteDialogActions}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={hideDialog}
                  disabled={deleting}
                  activeOpacity={0.7}
                >
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.confirmDeleteBtn, deleting && { opacity: 0.6 }]}
                  onPress={handleDelete}
                  disabled={deleting}
                  activeOpacity={0.7}
                >
                  {deleting ? (
                    <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight: 4 }} />
                  ) : (
                    <Icon source="delete" size={15} color="#FFFFFF" />
                  )}
                  <Text style={styles.confirmDeleteBtnText}>{deleting ? 'Deleting...' : 'Delete'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Dialog>
        </Portal>
      </View>

    </TouchableWithoutFeedback>
  )
}
export default CustomCard

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1B1B1B',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    paddingHorizontal: 15,
    paddingVertical: 12,
    marginTop: 10,
    marginHorizontal: 14,
    overflow: 'hidden',
    position: 'relative',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 4,
  },
  selectedContainer: {
    borderWidth: 2,
    borderColor: '#FFFFFF',
    shadowOpacity: 0.35,
  },
  cardSheenTop: {
    position: 'absolute',
    top: -50,
    right: -25,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  cardSheenBottom: {
    position: 'absolute',
    bottom: -60,
    left: -30,
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: 'rgba(0, 0, 0, 0.14)',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  bankInfoContainer: {
    flex: 1,
    marginRight: 8,
  },
  bankHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  bankNameText: {
    flexShrink: 1,
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2.5,
  },
  yourCardBadge: {
    backgroundColor: '#FACC15',
    borderRadius: 3,
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    alignSelf: 'flex-start',
  },
  yourCardText: {
    color: '#111111',
    fontWeight: '800',
    fontSize: 8,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  cardTierBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    borderRadius: 3,
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    alignSelf: 'flex-start',
    maxWidth: 140,
  },
  cardTierText: {
    color: '#FFFFFF',
    fontSize: 8,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  actionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    borderRadius: 16,
    paddingHorizontal: 5,
    paddingVertical: 2.5,
    gap: 4,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  actionIconBtn: {
    padding: 2.5,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectionCheckWrap: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 2,
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  chipAndWaveContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chipWrapper: {
    width: 26,
    height: 18,
    borderRadius: 3.5,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  contactlessWrapper: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  limitContainer: {
    alignItems: 'flex-end',
  },
  limitValueText: {
    color: '#FFFFFF',
    fontSize: 11.5,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  cardNumberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  cardNumberText: {
    color: '#FFFFFF',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 1.8,
    textShadowColor: 'rgba(0, 0, 0, 0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
    flex: 1,
  },
  copyNumberBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    paddingHorizontal: 6,
    paddingVertical: 2.5,
    borderRadius: 4,
    marginStart: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  copyCardBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  copyBtnActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.38)',
  },
  copyBtnText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '700',
    marginStart: 3,
  },
  detailsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: 5,
  },
  cardholderSection: {
    flex: 1.4,
    marginRight: 6,
  },
  cardMicroLabel: {
    color: 'rgba(255, 255, 255, 0.65)',
    fontSize: 7,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: 1,
    textTransform: 'uppercase',
  },
  cardholderText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  expiryCvvSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  expiryCol: {
    alignItems: 'flex-start',
  },
  cvvCol: {
    alignItems: 'flex-start',
  },
  cardDetailValText: {
    color: '#FFFFFF',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  networkTagContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: 'flex-end',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  networkTagText: {
    color: '#FFFFFF',
    fontSize: 8.5,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  cardFooterDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    marginVertical: 6,
    marginHorizontal: -3,
  },
  cardBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sharedBadgeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.22)',
    paddingHorizontal: 6,
    paddingVertical: 2.5,
    borderRadius: 10,
  },
  sharedBadgeText: {
    color: 'rgba(255, 255, 255, 0.95)',
    fontSize: 9.5,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  accessGroupsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.22)',
    paddingHorizontal: 6,
    paddingVertical: 2.5,
    borderRadius: 10,
    flex: 1,
    marginRight: 6,
  },
  accessGroupsText: {
    color: 'rgba(255, 255, 255, 0.95)',
    fontSize: 9.5,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  deleteDialog: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 20,
    marginHorizontal: 20,
  },
  deleteDialogBody: {
    alignItems: 'flex-start',
  },
  deleteTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  deleteDialogTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  deleteDialogMessage: {
    fontSize: 13.5,
    color: '#6B7280',
    textAlign: 'left',
    lineHeight: 19,
    marginBottom: 16,
  },
  deleteCardPreview: {
    width: '100%',
    borderRadius: 12,
    padding: 14,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  deleteCardPreviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  deleteCardPreviewBank: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
    textTransform: 'uppercase',
  },
  deleteCardPreviewBadge: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 10,
    fontWeight: '600',
  },
  deleteCardPreviewNumber: {
    color: '#FFFFFF',
    fontSize: 14.5,
    fontWeight: '700',
    letterSpacing: 1.2,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    marginBottom: 6,
  },
  deleteCardPreviewOwner: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  deleteDialogActions: {
    flexDirection: 'row',
    width: '100%',
    gap: 10,
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    color: '#374151',
    fontWeight: '600',
    fontSize: 14,
  },
  confirmDeleteBtn: {
    flex: 1,
    backgroundColor: '#EF4444',
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 5,
  },
  confirmDeleteBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  groupsDialog: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingVertical: 20,
    paddingHorizontal: 20,
    marginHorizontal: 20,
  },
  groupsDialogBody: {
    width: '100%',
  },
  groupsDialogHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  groupsDialogIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupsDialogTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  groupsDialogSubtitle: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 1,
  },
  groupsDialogMessage: {
    fontSize: 13.5,
    color: '#4B5563',
    lineHeight: 18,
    marginBottom: 12,
  },
  groupsListContainer: {
    maxHeight: 220,
    marginBottom: 16,
  },
  groupItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
    gap: 10,
  },
  groupItemIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupItemText: {
    fontSize: 13.5,
    fontWeight: '600',
    color: '#111827',
    flex: 1,
  },
  groupsDialogCloseBtn: {
    backgroundColor: '#111827',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupsDialogCloseText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
});
