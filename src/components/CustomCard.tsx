import { StyleSheet, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native'
import React, { useContext } from 'react'
import { Card } from '../types/Types'
import Clipboard from '@react-native-clipboard/clipboard'
import { convertLongNumberToText, removeSpaceFromString } from '../util/Utils'
import { BANK_COLORS, BANK_DICTIONARY, ENV } from '../constants/Constants'
import { Button, Dialog, Icon, Portal, Text, Tooltip } from 'react-native-paper'
import firestore from '@react-native-firebase/firestore';
import auth from '@react-native-firebase/auth';
import { ConnectivityContext } from '../util/Connectivity'

interface CardProps {
  cardDetails: Card,
  onCardLongPress: (card: Card) => void
}

const CustomCard: React.FC<CardProps> = ({ cardDetails, onCardLongPress }) => {
  const [visible, setVisible] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const isConnected = useContext(ConnectivityContext).isConnected;
  const cardsCollection = firestore().collection('cards');

  const showDialog = () => setVisible(true);
  const hideDialog = () => setVisible(false);

  const copyToClipboard = (text: string) => {
    Clipboard.setString(text);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  };

  const handleDelete = async () => {
    try {
      if (isConnected) {
        await cardsCollection.doc(cardDetails.key).delete();
      }
      hideDialog();
    } catch (error) {
      console.error('Error deleting card:', error);
    }
  };

  console.log("Logger: ", cardDetails);
  return (
    <TouchableWithoutFeedback onLongPress={() => { onCardLongPress(cardDetails) }}>

      <View style={[styles.container, { backgroundColor: BANK_COLORS[cardDetails.bankName] }]}>
        <View style={styles.spaceContainer}>
          <View style={{ flex: 1 }}>
            <Text style={styles.heading_1}>{'Card Owner'}</Text>
            <View style={{ flexGrow: 1, flexDirection: 'row' }}>
              <Text style={[styles.subheading_1, { marginRight: 10 }]}>{cardDetails.ownerName}
              </Text>
              <Tooltip title={`Limit: ${convertLongNumberToText(Number(cardDetails.limit))}`} enterTouchDelay={0}>
                <Icon
                  source="information"
                  color="white"
                  size={20}
                />
              </Tooltip>
            </View>
          </View>
          <TouchableWithoutFeedback onLongPress={() => copyToClipboard(`Bank Name: ${BANK_DICTIONARY[cardDetails.bankName]}\nName: ${cardDetails.ownerName}\nCard No: ${cardDetails.number}\nExp: ${cardDetails.month}/${cardDetails.year}\nCvv: ${cardDetails.cvv}`)}>
            <View style={{ alignSelf: 'center' }}>
              <Icon
                source="credit-card-chip"
                color="white"
                size={40}
              />
            </View>
          </TouchableWithoutFeedback>

        </View>
        <View style={[styles.spaceContainer]}>
          <View style={styles.cardNumberSection}>
            <Text style={styles.heading_1}>CARD NUMBER</Text>
            <TouchableWithoutFeedback onLongPress={() => copyToClipboard(cardDetails.number)}>
              <Text style={styles.subheading_2}>{cardDetails.number}</Text>
            </TouchableWithoutFeedback>
          </View>

          {
            isConnected && cardDetails.email === auth().currentUser?.email &&
            <TouchableOpacity style={{ justifyContent: 'center', alignItems: 'center' }} onPress={showDialog}>
              <Text style={styles.heading_1}>DELETE</Text>
              <Icon
                source="delete-empty"
                color="white"
                size={20}
              />
            </TouchableOpacity>
          }

        </View>
        <View style={styles.spaceContainer}>
          <View>
            <Text style={styles.heading_1}>EXPIRY & CVV</Text>
            <Text style={styles.subheading_2}>{cardDetails.month}/{cardDetails.year}     {cardDetails.cvv}</Text>
          </View>
          <View>
            <Text style={[styles.heading_1, { alignSelf: 'flex-end' }]}>BANK NAME</Text>
            <Text style={[styles.subheading_2, { marginBottom: 5 }]}>{BANK_DICTIONARY[cardDetails.bankName]}</Text>
            <View style={styles.subheading_3}><Text style={styles.highlighted_text}>{cardDetails.name}</Text></View>
          </View>

        </View>
        <Portal>
          <Dialog visible={visible} onDismiss={hideDialog}>
            <Dialog.Icon icon="file-alert" />
            <Dialog.Title>Confirm deletion</Dialog.Title>

            <Dialog.Content>
              <Text variant="bodyMedium">{`${cardDetails.number}\n${BANK_DICTIONARY[cardDetails.bankName]}\n${cardDetails.ownerName}`}</Text>
            </Dialog.Content>
            <Dialog.Actions>
              <Button onPress={handleDelete}>Delete</Button>
              <Button onPress={hideDialog}>Cancel</Button>
            </Dialog.Actions>
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
    padding: 18,
    marginTop: 12,
    marginStart: 10,
    marginEnd: 10,
    borderRadius: 10
  },
  heading_1: {
    alignSelf: 'flex-start',
    color: 'white',
    fontSize: 10
  },
  heading_2: {
    alignSelf: 'flex-end',
    color: 'white',
    fontSize: 10
  },
  subheading_1: {
    color: 'white'
  },
  subheading_2: {
    color: '#ffffff',
    fontSize: 20
  },
  spaceContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
    flex: 1
  },
  cardNumberSection: {
    marginBottom: 0,
    marginTop: 10
  },
  highlighted_text: {
    color: 'black',
    fontWeight: '900',
    width: "auto",
    fontSize: 10,
  },
  subheading_3: {
    backgroundColor: 'white',
    borderRadius: 10,
    alignSelf: 'flex-end',
    paddingHorizontal: 10,
  }


})
