#import "CardOverlayModule.h"
#import <UIKit/UIKit.h>
#import <UserNotifications/UserNotifications.h>

static NSString *const kCardOverlayNotificationId = @"card_overlay_notification";

@implementation CardOverlayModule

RCT_EXPORT_MODULE(CardOverlayModule);

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

RCT_EXPORT_METHOD(canDrawOverlays:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  // On iOS, system alert window is not supported, but banner/notification overlay is always available
  resolve(@(YES));
}

RCT_EXPORT_METHOD(requestOverlayPermission)
{
  UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
  [center requestAuthorizationWithOptions:(UNAuthorizationOptionAlert | UNAuthorizationOptionSound | UNAuthorizationOptionBadge)
                        completionHandler:^(BOOL granted, NSError * _Nullable error) {}];
}

RCT_EXPORT_METHOD(showCardOverlay:(NSDictionary *)cardData
                  resolve:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSString *bankName = cardData[@"bankName"] ?: @"";
  NSString *cardName = cardData[@"cardName"] ?: @"";
  NSString *cardNumber = cardData[@"cardNumber"] ?: @"";
  NSString *last4 = cardData[@"last4"] ?: @"";
  NSString *expiry = cardData[@"expiry"] ?: @"";
  NSString *cvv = cardData[@"cvv"] ?: @"";

  UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];

  [center requestAuthorizationWithOptions:(UNAuthorizationOptionAlert | UNAuthorizationOptionSound | UNAuthorizationOptionBadge)
                        completionHandler:^(BOOL granted, NSError * _Nullable error) {
    if (granted) {
      UNMutableNotificationContent *content = [[UNMutableNotificationContent alloc] init];

      NSString *header = @"";
      if (bankName.length > 0) {
        header = [NSString stringWithFormat:@"💳 %@", bankName];
      } else if (cardName.length > 0) {
        header = [NSString stringWithFormat:@"💳 %@", cardName];
      } else if (last4.length > 0) {
        header = [NSString stringWithFormat:@"💳 Card • %@", last4];
      } else {
        header = @"💳 Card Details";
      }

      content.title = header;
      if (cardNumber.length > 0) {
        content.subtitle = [NSString stringWithFormat:@"%@   •   EXP: %@   •   CVV: %@", cardNumber, expiry.length > 0 ? expiry : @"--/--", cvv.length > 0 ? cvv : @"---"];
      } else {
        content.subtitle = [NSString stringWithFormat:@"EXPIRY: %@   |   CVV: %@", expiry.length > 0 ? expiry : @"--/--", cvv.length > 0 ? cvv : @"---"];
      }
      content.body = @"Tap to return to wallet. Card details remain visible here while paying.";
      content.sound = [UNNotificationSound defaultSound];

      UNTimeIntervalNotificationTrigger *trigger = [UNTimeIntervalNotificationTrigger triggerWithTimeInterval:0.1 repeats:NO];
      UNNotificationRequest *request = [UNNotificationRequest requestWithIdentifier:kCardOverlayNotificationId content:content trigger:trigger];

      [center addNotificationRequest:request withCompletionHandler:nil];
    }
  }];

  // Move the app to background (suspend) on main thread
  dispatch_async(dispatch_get_main_queue(), ^{
    SEL suspendSelector = NSSelectorFromString(@"suspend");
    if ([[UIApplication sharedApplication] respondsToSelector:suspendSelector]) {
      #pragma clang diagnostic push
      #pragma clang diagnostic ignored "-Warc-performSelector-leaks"
      [[UIApplication sharedApplication] performSelector:suspendSelector];
      #pragma clang diagnostic pop
    }
  });

  resolve(@(YES));
}

RCT_EXPORT_METHOD(hideCardOverlay)
{
  UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
  [center removeDeliveredNotificationsWithIdentifiers:@[kCardOverlayNotificationId]];
  [center removePendingNotificationRequestsWithIdentifiers:@[kCardOverlayNotificationId]];
}

RCT_EXPORT_METHOD(minimizeApp)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    SEL suspendSelector = NSSelectorFromString(@"suspend");
    if ([[UIApplication sharedApplication] respondsToSelector:suspendSelector]) {
      #pragma clang diagnostic push
      #pragma clang diagnostic ignored "-Warc-performSelector-leaks"
      [[UIApplication sharedApplication] performSelector:suspendSelector];
      #pragma clang diagnostic pop
    }
  });
}

@end

