#import "AppDelegate.h"
#import <Firebase.h>

#import <React/RCTBundleURLProvider.h>

@implementation AppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  self.moduleName = @"CWallet";
  // You can add your custom initial props in the dictionary below.
  // They will be passed down to the ViewController used by React Native.
  [FIRApp configure];
  self.initialProps = @{};
  [UNUserNotificationCenter currentNotificationCenter].delegate = self;

  return [super application:application didFinishLaunchingWithOptions:launchOptions];
}

- (void)userNotificationCenter:(UNUserNotificationCenter *)center
       willPresentNotification:(UNNotification *)notification
         withCompletionHandler:(void (^)(UNNotificationPresentationOptions options))completionHandler
{
  if (@available(iOS 14.0, *)) {
    completionHandler(UNNotificationPresentationOptionBanner | UNNotificationPresentationOptionSound | UNNotificationPresentationOptionList);
  } else {
    completionHandler(UNNotificationPresentationOptionAlert | UNNotificationPresentationOptionSound);
  }
}

- (void)userNotificationCenter:(UNUserNotificationCenter *)center
didReceiveNotificationResponse:(UNNotificationResponse *)response
         withCompletionHandler:(void (^)(void))completionHandler
{
  if ([response.notification.request.identifier isEqualToString:@"card_overlay_notification"]) {
    [[UNUserNotificationCenter currentNotificationCenter] removeDeliveredNotificationsWithIdentifiers:@[@"card_overlay_notification"]];
    [[UNUserNotificationCenter currentNotificationCenter] removePendingNotificationRequestsWithIdentifiers:@[@"card_overlay_notification"]];
  }
  completionHandler();
}

- (void)applicationDidBecomeActive:(UIApplication *)application
{
  if ([super respondsToSelector:@selector(applicationDidBecomeActive:)]) {
    [super applicationDidBecomeActive:application];
  }
  // Automatically dismiss the floating card overlay notification when app opens or returns to foreground
  [[UNUserNotificationCenter currentNotificationCenter] removeDeliveredNotificationsWithIdentifiers:@[@"card_overlay_notification"]];
  [[UNUserNotificationCenter currentNotificationCenter] removePendingNotificationRequestsWithIdentifiers:@[@"card_overlay_notification"]];
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  return [self bundleURL];
}

- (NSURL *)bundleURL
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

@end
