#import <Cocoa/Cocoa.h>
#import <CoreServices/CoreServices.h>
#import <Foundation/Foundation.h>
#import <objc/runtime.h>

NSString* fakeBundleIdentifier = nil;

NSString* getBundleIdentifier(NSString* appName);
BOOL setApplication(NSString* newbundleIdentifier);
NSDictionary* sendNotification(NSString* title, NSString* subtitle, NSString* message, NSDictionary* options);

@implementation NSBundle (swizzle)
- (NSString*)__bundleIdentifier {
    if (self == [NSBundle mainBundle]) {
        return fakeBundleIdentifier ? fakeBundleIdentifier : @"com.apple.Terminal";
    } else {
        return [self __bundleIdentifier];
    }
}
@end

BOOL installNSBundleHook(void) {
    Class class = objc_getClass("NSBundle");
    if (class) {
        method_exchangeImplementations(class_getInstanceMethod(class, @selector(bundleIdentifier)),
                                       class_getInstanceMethod(class, @selector(__bundleIdentifier)));
        return YES;
    }
    return NO;
}

@interface NotificationCenterDelegate: NSObject <NSUserNotificationCenterDelegate>
@property(nonatomic, assign) BOOL keepRunning;
@property(nonatomic, assign) BOOL waitForClick;
@property(nonatomic, retain) NSDictionary* actionData;
@end

// Delegate to respond to events in the NSUserNotificationCenter
// See https://developer.apple.com/documentation/foundation/nsusernotificationcenterdelegate?language=objc
@implementation NotificationCenterDelegate
- (void)userNotificationCenter:(NSUserNotificationCenter*)center
        didDeliverNotification:(NSUserNotification*)notification {
    // Stop running if we're not expecting a response
    if (!notification.hasActionButton && !notification.hasReplyButton && !self.waitForClick) {
        self.keepRunning = NO;
    }
}

// Most typical actions
- (void)userNotificationCenter:(NSUserNotificationCenter*)center
       didActivateNotification:(NSUserNotification*)notification {
    long long additionalActionIndex = ULONG_MAX;

    // Switch on how the notification was interacted with
    // See https://developer.apple.com/documentation/foundation/nsusernotification/1416143-activationtype?language=objc
    switch (notification.activationType) {
        case NSUserNotificationActivationTypeActionButtonClicked:
        case NSUserNotificationActivationTypeAdditionalActionClicked: {
            if ([[(NSObject*)notification valueForKey:@"_alternateActionButtonTitles"] count] > 1) {
                NSNumber* alternateActionIndex = [(NSObject*)notification valueForKey:@"_alternateActionIndex"];
                additionalActionIndex = [alternateActionIndex unsignedLongLongValue];

                if (additionalActionIndex == LONG_MAX) {
                    self.actionData = @{@"activationType": @"actionClicked", @"activationValue": notification.actionButtonTitle};
                    break;
                }

                NSString* ActionsClicked = [(NSObject*)notification valueForKey:@"_alternateActionButtonTitles"][additionalActionIndex];

                self.actionData = @{@"activationType": @"actionClicked", @"activationValue": ActionsClicked, @"activationValueIndex": [NSString stringWithFormat:@"%llu", additionalActionIndex]};
            } else {
                self.actionData = @{@"activationType": @"actionClicked", @"activationValue": notification.actionButtonTitle};
            }
            break;
        }

        case NSUserNotificationActivationTypeContentsClicked: {
            self.actionData = @{@"activationType": @"contentsClicked"};
            break;
        }

        case NSUserNotificationActivationTypeReplied: {
            self.actionData = @{@"activationType": @"replied", @"activationValue": notification.response.string};
            break;
        }
        case NSUserNotificationActivationTypeNone:
        default: {
            self.actionData = @{@"activationType": @"none"};
            break;
        }
    }

    // Stop running after interacting with the notification
    self.keepRunning = NO;

    // Force-close the notification after interacting with it
    [center removeDeliveredNotification:notification];
}

// Specific to the close/other button
- (void)userNotificationCenter:(NSUserNotificationCenter*)center
               didDismissAlert:(NSUserNotification*)notification {
    self.actionData = @{@"activationType": @"closeClicked", @"activationValue": notification.otherButtonTitle};

    // Stop running after interacting with the notification
    self.keepRunning = NO;

    // Force-close the notification after interacting with it
    [center removeDeliveredNotification:notification];
}
@end

// Utility function to create an NSImage from an url
NSImage* getImageFromURL(NSString* url) {
    NSURL* imageURL = [NSURL URLWithString:url];
    if ([[imageURL scheme] length] == 0) {
        // Prefix 'file://' if no scheme
        imageURL = [NSURL fileURLWithPath:url];
    }
    return [[NSImage alloc] initWithContentsOfURL:imageURL];
}
