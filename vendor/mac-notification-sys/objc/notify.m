#import "notify.h"

// getBundleIdentifier(app_name: &str) -> "com.apple.Terminal"
NSString* getBundleIdentifier(NSString* appName) {
    NSString* findString = [NSString stringWithFormat:@"get id of application \"%@\"", appName];
    NSAppleScript* findScript = [[NSAppleScript alloc] initWithSource:findString];
    NSAppleEventDescriptor* resultDescriptor = [findScript executeAndReturnError:nil];
    return [resultDescriptor stringValue];
}

// setApplication(new_bundle_identifier: &str) -> Result<()>
// invariant: this function should be called at most once and before `sendNotification`
BOOL setApplication(NSString* newbundleIdentifier) {
    @autoreleasepool {
        if (!installNSBundleHook()) {
            return NO;
        }
        if (LSCopyApplicationURLsForBundleIdentifier((CFStringRef)newbundleIdentifier, NULL) != NULL) {
            [fakeBundleIdentifier release]; // Release old value - nil is ok
            fakeBundleIdentifier = newbundleIdentifier;
            [newbundleIdentifier retain]; // Retain new value - it outlives this scope

            return YES;
        }
        return NO;
    }
}

// sendNotification(title: &str, subtitle: &str, message: &str, options: Notification) -> NotificationResult<()>
NSDictionary* sendNotification(NSString* title, NSString* subtitle, NSString* message, NSDictionary* options) {
    @autoreleasepool {
        // For a list of available notification options, see https://developer.apple.com/documentation/foundation/nsusernotification?language=objc

        NSUserNotificationCenter* notificationCenter = [NSUserNotificationCenter defaultUserNotificationCenter];
        NotificationCenterDelegate* ncDelegate = [[NotificationCenterDelegate alloc] init];
        notificationCenter.delegate = ncDelegate;

        // By default, do not wait for interaction unless an action or schedule is set.
        // This can be overriden with `asynchronous` in order to always "fire and forget"
        ncDelegate.keepRunning = NO;

        NSUserNotification* userNotification = [[NSUserNotification alloc] init];
        BOOL isScheduled = NO;

        // Basic text
        userNotification.title = title;
        if (![subtitle isEqualToString:@""]) {
            userNotification.subtitle = subtitle;
        }
        userNotification.informativeText = message;

        // Notification sound
        if (options[@"sound"] && ![options[@"sound"] isEqualToString:@""]) {
            if ([options[@"sound"] isEqualToString:@"NSUserNotificationDefaultSoundName"]) {
                userNotification.soundName = NSUserNotificationDefaultSoundName;
            } else {
                userNotification.soundName = options[@"sound"];
            }
        }

        // Delivery Date/Schedule
        if (options[@"deliveryDate"] && ![options[@"deliveryDate"] isEqualToString:@""]) {
            ncDelegate.keepRunning = YES;
            double deliveryDate = [options[@"deliveryDate"] doubleValue];
            NSDate* scheduleTime = [NSDate dateWithTimeIntervalSince1970:deliveryDate];
            userNotification.deliveryDate = scheduleTime;
            NSLog(@"Delivery date option passed as %@ converted to %f resulting in %@", options[@"deliveryDate"], deliveryDate, scheduleTime);
            isScheduled = YES;
        }

        // Main Actions Button (defaults to "Show")
        if (options[@"mainButtonLabel"] && ![options[@"mainButtonLabel"] isEqualToString:@""]) {
            ncDelegate.keepRunning = YES;
            userNotification.actionButtonTitle = options[@"mainButtonLabel"];
            userNotification.hasActionButton = 1;
        } else {
            userNotification.hasActionButton = 0;
        }

        // Dropdown actions
        if (options[@"actions"] && ![options[@"actions"] isEqualToString:@""]) {
            ncDelegate.keepRunning = YES;
            [userNotification setValue:@YES forKey:@"_showsButtons"];

            NSArray* myActions = [options[@"actions"] componentsSeparatedByString:@","];

            if (myActions.count > 1) {
                [userNotification setValue:@YES forKey:@"_alwaysShowAlternateActionMenu"];
                [userNotification setValue:myActions forKey:@"_alternateActionButtonTitles"];
            }
        }

        // Close/Other button (defaults to "Cancel")
        if (options[@"closeButtonLabel"] && ![options[@"closeButtonLabel"] isEqualToString:@""]) {
            ncDelegate.keepRunning = YES;
            [userNotification setValue:@YES forKey:@"_showsButtons"];
            userNotification.otherButtonTitle = options[@"closeButtonLabel"];
        }

        // Reply to the notification with a text field
        if (options[@"response"] && ![options[@"response"] isEqualToString:@""]) {
            ncDelegate.keepRunning = YES;
            userNotification.hasReplyButton = 1;
            userNotification.responsePlaceholder = options[@"mainButtonLabel"];
        }

        // Wait for click
        if (options[@"click"] && [options[@"click"] isEqualToString:@"yes"]) {
            ncDelegate.keepRunning = YES;
            ncDelegate.waitForClick = YES;
        }

        // Change the icon of the app in the notification
        if (options[@"appIcon"] && ![options[@"appIcon"] isEqualToString:@""]) {
            NSImage* icon = getImageFromURL(options[@"appIcon"]);
            // replacement app icon
            [userNotification setValue:icon forKey:@"_identityImage"];
            [userNotification setValue:@(false) forKey:@"_identityImageHasBorder"];
        }
        // Change the additional content image
        if (options[@"contentImage"] && ![options[@"contentImage"] isEqualToString:@""]) {
            userNotification.contentImage = getImageFromURL(options[@"contentImage"]);
        }

        // If set to asynchronous, do not wait for actions
        if (options[@"asynchronous"] && [options[@"asynchronous"] isEqualToString:@"yes"]) {
            ncDelegate.keepRunning = NO;
        }

        // Send or schedule notification
        if (isScheduled) {
            [notificationCenter scheduleNotification:userNotification];
        } else {
            [notificationCenter deliverNotification:userNotification];
        }

        [NSThread sleepForTimeInterval:0.1f];

        // TODO: Issue #4 mentions an issue with multithreading, perhaps there could be an overall "synchronous" option (instead of deliveryDate's synchronous section)
        // Loop/wait for a user action if needed
        while (ncDelegate.keepRunning) {
            [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.1]];
        }

        // XXX: prevents crash described in https://github.com/h4llow3En/mac-notification-sys/issues/64
        // TODO: the underlying issue is not yet understood
        if (ncDelegate.actionData != NULL) {
            return ncDelegate.actionData;
        } else {
            return [[NSDictionary alloc] init];
        }
    }
}
