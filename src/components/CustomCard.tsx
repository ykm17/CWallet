import { StyleSheet, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native'
import React, { useContext, useState } from 'react'
import { Card } from '../types/Types'
import Clipboard from '@react-native-clipboard/clipboard'
import { convertLongNumberToText, formatCardLimit, removeSpaceFromString } from '../util/Utils'
import { BANK_COLORS, BANK_DICTIONARY, CARD_NETWORKS, CARD_TYPES, ENV } from '../constants/Constants'
import { Button, Dialog, Icon, Portal, Text, Tooltip } from 'react-native-paper'
import auth from '@react-native-firebase/auth';
import { ConnectivityContext } from '../util/Connectivity'
import { deleteOwnedCard } from '../services/cardService'

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
  const [copiedField, setCopiedField] = useState<'number' | 'card' | null>(null);
  const isConnected = useContext(ConnectivityContext).isConnected;

  const showDialog = () => setVisible(true);
  const hideDialog = () => setVisible(false);

  const handleEdit = () => {
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

  const handleDelete = async () => {
    try {
      if (isConnected) {
        await deleteOwnedCard(cardDetails.key);
      }
      hideDialog();
    } catch (error) {
      console.error('Error deleting card:', error);
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
    ].filter(Boolean);
    return lines.join('\n');
  };

  const limitFormatted = formatCardLimit(cardDetails.limit);

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
        {/* Row 1: Card Owner & Limit (Left) & Edit/Delete Buttons (Top Right) */}
        <View style={styles.spaceContainer}>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={styles.heading_1} numberOfLines={1}>
              {limitFormatted ? 'OWNER | LIMIT' : 'CARD OWNER'}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 1 }}>
              <Text
                style={styles.subheading_1}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.75}
              >
                {cardDetails.ownerName}
                {limitFormatted ? ` | ${limitFormatted}` : ''}
              </Text>
            </View>
          </View>

          {isConnected && isOwner && !selectionMode && (
            <View style={styles.topRightActions}>
              {onShare && (
                <TouchableOpacity
                  style={styles.actionIconBtn}
                  onPress={() => onShare(cardDetails)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Icon source="share-variant" color="white" size={18} />
                </TouchableOpacity>
              )}
              {onUnshare && !!cardDetails.sharedGroupIds?.length && (
                <TouchableOpacity
                  style={styles.actionIconBtn}
                  onPress={() => onUnshare(cardDetails)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Icon source="share-off" color="white" size={18} />
                </TouchableOpacity>
              )}
              {onCardEdit && (
                <TouchableOpacity
                  style={styles.actionIconBtn}
                  onPress={handleEdit}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Icon source="pencil" color="white" size={18} />
                </TouchableOpacity>
              )}
              {onCardEdit && (
                <TouchableOpacity
                  style={styles.actionIconBtn}
                  onPress={showDialog}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Icon source="delete-outline" color="white" size={18} />
                </TouchableOpacity>
              )}
            </View>
          )}
          {selectionMode && (
            <Icon
              source={isSelected ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'}
              color="white"
              size={22}
            />
          )}

        </View>

        {/* Row 2 (Vertically Center): Card Number (Left) & Chip Icon (Vertically Centered on Right) */}
        <View style={[styles.spaceContainer, { alignItems: 'center' }]}>
          <View style={styles.cardNumberSection}>
            <Text style={styles.heading_1}>CARD NUMBER</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
              <TouchableWithoutFeedback onLongPress={copyNumber}>
                <Text style={styles.subheading_2}>{cardDetails.number}</Text>
              </TouchableWithoutFeedback>
              <TouchableOpacity
                style={[styles.copyNumberBtn, copiedField === 'number' && styles.copyBtnActive]}
                onPress={copyNumber}
                activeOpacity={0.7}
              >
                <Icon
                  source={copiedField === 'number' ? 'check' : 'content-copy'}
                  color="white"
                  size={10}
                />
                <Text style={styles.copyBtnText}>
                  {copiedField === 'number' ? 'Copied' : 'Copy'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <TouchableWithoutFeedback onLongPress={copyWholeCard}>
            <View style={styles.centerChipContainer}>
              <Icon
                source="credit-card-chip"
                color="white"
                size={34}
              />
            </View>
          </TouchableWithoutFeedback>
        </View>

        {/* Row 3: Expiry & CVV + Card Name (Left), Bank Name + Network/Card Type in Italic (Right) */}
        <View style={[styles.spaceContainer, { marginTop: 4 }]}>
          <View style={{ justifyContent: 'flex-end', flex: 1, paddingRight: 6 }}>
            <Text style={styles.heading_1}>EXPIRY & CVV</Text>
            <Text style={styles.subheading_2}>
              {cardDetails.month}/{cardDetails.year}     {cardDetails.cvv}
            </Text>

            <View style={styles.labelRow}>
              {showYourCardLabel && isOwner ? (
                <View style={styles.yourCardContainer}>
                  <Text style={styles.yourCardText}>Your Card</Text>
                </View>
              ) : null}
              {cardDetails.name ? (
                <View style={styles.cardNameContainer}>
                  <Text style={styles.cardNameText}>{cardDetails.name}</Text>
                </View>
              ) : null}
            </View>
          </View>

          <View style={{ alignItems: 'flex-end', justifyContent: 'flex-end', flex: 1, paddingLeft: 6 }}>
            <Text style={[styles.heading_1, { alignSelf: 'flex-end' }]}>BANK NAME</Text>
            <Text
              style={[styles.subheading_2, styles.bankNameText]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
            >
              {BANK_DICTIONARY[cardDetails.bankName]}
            </Text>
            {badgeLabel ? (
              <View style={styles.networkTagContainer}>
                <Text style={styles.networkTagText}>{badgeLabel}</Text>
              </View>
            ) : null}
          </View>
        </View>

        {!!cardDetails.accessGroupNames?.length && (
          <View style={styles.accessGroupsContainer}>
            <Icon source="account-group-outline" size={13} color="rgba(255, 255, 255, 0.85)" />
            <Text style={styles.accessGroupsText}>
              via {cardDetails.accessGroupNames.join(', ')}
            </Text>
          </View>
        )}

        {/* Copy Card Option at Bottom Center */}
        <View style={styles.bottomCenterContainer}>
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
              color="white"
              size={11}
            />
            <Text style={styles.copyBtnText}>
              {copiedField === 'card' ? 'Copied' : 'Copy Card'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Modern Delete Confirmation Dialog */}
        <Portal>
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
                  {cardDetails.number}
                </Text>
                <Text style={styles.deleteCardPreviewOwner} numberOfLines={1}>
                  {cardDetails.ownerName}
                </Text>
              </View>

              <View style={styles.deleteDialogActions}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={hideDialog}
                  activeOpacity={0.7}
                >
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.confirmDeleteBtn}
                  onPress={handleDelete}
                  activeOpacity={0.7}
                >
                  <Icon source="delete" size={15} color="#FFFFFF" />
                  <Text style={styles.confirmDeleteBtnText}>Delete</Text>
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
    padding: 16,
    marginTop: 12,
    marginStart: 10,
    marginEnd: 10,
    borderRadius: 12,
  },
  selectedContainer: {
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  labelRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  yourCardContainer: {
    backgroundColor: '#FACC15',
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  yourCardText: {
    color: '#111111',
    fontWeight: '800',
    fontSize: 9,
    textTransform: 'uppercase',
  },
  accessGroupsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 6,
    paddingHorizontal: 2,
  },
  accessGroupsText: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  heading_1: {
    alignSelf: 'flex-start',
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 9,
    letterSpacing: 0.5,
    fontWeight: '600',
  },
  heading_2: {
    alignSelf: 'flex-end',
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 9,
    letterSpacing: 0.5,
  },
  subheading_1: {
    color: 'white',
    fontSize: 13,
    fontWeight: '600',
  },
  subheading_2: {
    color: '#ffffff',
    fontSize: 15,
    letterSpacing: 0.5,
    fontWeight: '600',
  },
  bankNameText: {
    marginBottom: 4,
    textAlign: 'right',
    maxWidth: '100%',
  },
  spaceContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
    flex: 1,
  },
  cardNumberSection: {
    marginBottom: 0,
    marginTop: 6,
    flex: 1,
  },
  topRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  actionIconBtn: {
    padding: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  centerChipContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    marginStart: 8,
  },
  copyNumberBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginStart: 6,
  },
  bottomCenterContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  copyCardBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  copyBtnActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.38)',
  },
  copyBtnText: {
    color: '#FFFFFF',
    fontSize: 9.5,
    fontWeight: '600',
    marginStart: 3,
  },
  cardNameContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  cardNameText: {
    color: '#000000',
    fontWeight: '800',
    fontSize: 9,
    textTransform: 'uppercase',
  },
  networkTagContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    alignSelf: 'flex-end',
    marginTop: 4,
  },
  networkTagText: {
    color: '#FFFFFF',
    fontSize: 9.5,
    fontStyle: 'italic',
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  deleteDialog: {
    backgroundColor: '#F8F9FA',
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 18,
    marginHorizontal: 20,
  },
  deleteDialogBody: {
    alignItems: 'flex-start',
  },
  deleteTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  deleteDialogTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111111',
  },
  deleteDialogMessage: {
    fontSize: 13,
    color: '#666666',
    textAlign: 'left',
    lineHeight: 18,
    marginBottom: 14,
  },
  deleteCardPreview: {
    width: '100%',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  deleteCardPreviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  deleteCardPreviewBank: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
  },
  deleteCardPreviewBadge: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 10,
    fontStyle: 'italic',
  },
  deleteCardPreviewNumber: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  deleteCardPreviewOwner: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: 11,
    fontWeight: '500',
  },
  deleteDialogActions: {
    flexDirection: 'row',
    width: '100%',
    gap: 10,
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    color: '#4B5563',
    fontWeight: '600',
    fontSize: 14,
  },
  confirmDeleteBtn: {
    flex: 1,
    backgroundColor: '#D32F2F',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  confirmDeleteBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
});
