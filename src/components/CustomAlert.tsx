import React, { useEffect, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Dialog, Icon, Portal, Text } from 'react-native-paper';

export interface AlertButton {
  text?: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
}

export interface AlertOptions {
  cancelable?: boolean;
  onDismiss?: () => void;
}

export interface AlertConfig {
  title: string;
  message?: string;
  buttons?: AlertButton[];
  options?: AlertOptions;
}

type AlertListener = (config: AlertConfig | null) => void;
let alertListener: AlertListener | null = null;

export const showAlert = (
  title: string,
  message?: string,
  buttons?: AlertButton[],
  options?: AlertOptions,
) => {
  if (alertListener) {
    alertListener({ title, message, buttons, options });
  } else {
    console.warn('CustomAlertHost is not mounted. Alert dropped:', title, message);
  }
};

export const CustomAlert = {
  alert: showAlert,
};

export const Alert = CustomAlert;

export const CustomAlertHost: React.FC = () => {
  const [config, setConfig] = useState<AlertConfig | null>(null);

  useEffect(() => {
    alertListener = setConfig;
    return () => {
      alertListener = null;
    };
  }, []);

  if (!config) {
    return null;
  }

  const handleDismiss = () => {
    const currentConfig = config;
    setConfig(null);
    currentConfig.options?.onDismiss?.();
  };

  const handleButtonPress = (btn?: AlertButton) => {
    setConfig(null);
    btn?.onPress?.();
  };

  const isDestructive = config.buttons?.some((b) => b.style === 'destructive');
  const lowerTitle = (config.title || '').toLowerCase();
  const lowerMsg = (config.message || '').toLowerCase();

  let iconName = 'information-outline';
  let iconColor = '#111111';
  let iconBg = '#F3F4F6';

  if (lowerTitle.includes('offline') || lowerMsg.includes('offline')) {
    iconName = 'cloud-off-outline';
    iconColor = '#DC2626';
    iconBg = '#FEE2E2';
  } else if (
    isDestructive ||
    lowerTitle.includes('delete') ||
    lowerTitle.includes('remove') ||
    lowerTitle.includes('leave') ||
    lowerTitle.includes('unshare')
  ) {
    iconName = isDestructive && lowerTitle.includes('delete') ? 'trash-can-outline' : 'alert-circle-outline';
    iconColor = '#DC2626';
    iconBg = '#FEE2E2';
  } else if (
    lowerTitle.includes('fail') ||
    lowerTitle.includes('error') ||
    lowerTitle.includes('could not') ||
    lowerTitle.includes('unable')
  ) {
    iconName = 'alert-circle-outline';
    iconColor = '#DC2626';
    iconBg = '#FEE2E2';
  } else if (
    lowerTitle.includes('shared') ||
    lowerTitle.includes('success') ||
    lowerTitle.includes('saved') ||
    lowerTitle.includes('unshared')
  ) {
    iconName = 'check-circle-outline';
    iconColor = '#10B981';
    iconBg = '#ECFDF5';
  } else if (lowerTitle.includes('share') || lowerTitle.includes('group')) {
    iconName = 'account-group-outline';
    iconColor = '#111111';
    iconBg = '#F3F4F6';
  } else if (lowerTitle.includes('nfc')) {
    iconName = 'nfc';
    iconColor = '#111111';
    iconBg = '#F3F4F6';
  }

  const buttons =
    config.buttons && config.buttons.length > 0
      ? config.buttons
      : [{ text: 'OK', style: 'default' as const }];

  return (
    <Portal>
      <Dialog
        visible={Boolean(config)}
        onDismiss={handleDismiss}
        style={styles.dialog}
        dismissable={config.options?.cancelable ?? true}
      >
        <View style={styles.dialogContent}>
          <View style={styles.header}>
            <View style={[styles.iconContainer, { backgroundColor: iconBg }]}>
              <Icon source={iconName} size={20} color={iconColor} />
            </View>
            <Text style={styles.title}>{config.title}</Text>
          </View>

          {Boolean(config.message) && (
            <Text style={styles.message}>{config.message}</Text>
          )}

          <View style={styles.actions}>
            {buttons.map((btn, index) => {
              const isCancel = btn.style === 'cancel';
              const isDestruct = btn.style === 'destructive';
              const isPrimary = !isCancel && !isDestruct;

              return (
                <TouchableOpacity
                  key={`${btn.text || 'btn'}-${index}`}
                  style={[
                    styles.button,
                    isCancel && styles.cancelButton,
                    isDestruct && styles.destructiveButton,
                    isPrimary && styles.primaryButton,
                  ]}
                  onPress={() => handleButtonPress(btn)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.buttonText,
                      isCancel && styles.cancelButtonText,
                      (isDestruct || isPrimary) && styles.primaryButtonText,
                    ]}
                  >
                    {btn.text || 'OK'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </Dialog>
    </Portal>
  );
};

export default CustomAlertHost;

const styles = StyleSheet.create({
  dialog: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 18,
    paddingHorizontal: 18,
    marginHorizontal: 24,
  },
  dialogContent: {
    padding: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  iconContainer: {
    width: 38,
    height: 38,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111111',
    flex: 1,
  },
  message: {
    fontSize: 14,
    color: '#4B5563',
    lineHeight: 20,
    marginBottom: 18,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'flex-end',
    marginTop: 4,
  },
  button: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: {
    backgroundColor: '#F3F4F6',
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
  primaryButton: {
    backgroundColor: '#111111',
  },
  destructiveButton: {
    backgroundColor: '#DC2626',
  },
  primaryButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  buttonText: {
    fontSize: 14,
  },
});

