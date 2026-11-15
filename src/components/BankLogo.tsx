import React from 'react';
import { Image, ImageSourcePropType, ImageStyle, StyleSheet, View, ViewStyle, StyleProp } from 'react-native';

export const BANK_LOGOS: Record<string, ImageSourcePropType> = {
  HD: require('../assets/bank_logos/HD.png'),
  IC: require('../assets/bank_logos/IC.png'),
  AX: require('../assets/bank_logos/AX.png'),
  AM: require('../assets/bank_logos/AM.png'),
  DC: require('../assets/bank_logos/DC.png'),
  HS: require('../assets/bank_logos/HS.png'),
  KT: require('../assets/bank_logos/KT.png'),
  ID: require('../assets/bank_logos/ID.png'),
  SB: require('../assets/bank_logos/SB.png'),
  FD: require('../assets/bank_logos/FD.png'),
  SW: require('../assets/bank_logos/SW.png'),
  IN: require('../assets/bank_logos/IN.png'),
  CT: require('../assets/bank_logos/CT.png'),
  RL: require('../assets/bank_logos/RL.png'),
  BB: require('../assets/bank_logos/BB.png'),
  AU: require('../assets/bank_logos/AU.png'),
  PN: require('../assets/bank_logos/PN.png'),
  CN: require('../assets/bank_logos/CN.png'),
  UN: require('../assets/bank_logos/UN.png'),
  YS: require('../assets/bank_logos/YS.png'),
  SC: require('../assets/bank_logos/SC.png'),
  DB: require('../assets/bank_logos/DB.png'),
  BO: require('../assets/bank_logos/BO.png'),
  IB: require('../assets/bank_logos/IB.png'),
  CB: require('../assets/bank_logos/CB.png'),
  IDB: require('../assets/bank_logos/IDB.png'),
  BD: require('../assets/bank_logos/BD.png'),
  KV: require('../assets/bank_logos/KV.png'),
  SI: require('../assets/bank_logos/SI.png'),
  UB: require('../assets/bank_logos/UB.png'),
  IO: require('../assets/bank_logos/IO.png'),
  PS: require('../assets/bank_logos/PS.png'),
  JK: require('../assets/bank_logos/JK.png'),
  PX: require('../assets/bank_logos/PX.png'),
  OT: require('../assets/bank_logos/OT.png'),
};

interface BankLogoProps {
  bankKey?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
  imageStyle?: StyleProp<ImageStyle>;
  withCardBadge?: boolean;
}

export const BankLogo: React.FC<BankLogoProps> = ({
  bankKey = 'OT',
  size = 24,
  style,
  imageStyle,
  withCardBadge = false,
}) => {
  const logoSource = BANK_LOGOS[bankKey] || BANK_LOGOS.OT;
  const borderRadius = Math.round(size * 0.22);

  if (withCardBadge) {
    return (
      <View
        style={[
          styles.badgeWrapper,
          {
            width: size + 4,
            height: size + 4,
            borderRadius: borderRadius + 2,
          },
          style,
        ]}
      >
        <Image
          source={logoSource}
          style={[
            {
              width: size,
              height: size,
              borderRadius,
            },
            imageStyle,
          ]}
          resizeMode="contain"
        />
      </View>
    );
  }

  return (
    <View
      style={[
        styles.logoContainer,
        {
          width: size,
          height: size,
          borderRadius,
        },
        style,
      ]}
    >
      <Image
        source={logoSource}
        style={[
          {
            width: size,
            height: size,
            borderRadius,
          },
          imageStyle,
        ]}
        resizeMode="contain"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  logoContainer: {
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  badgeWrapper: {
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 1.5,
    elevation: 2,
  },
});

export default BankLogo;

