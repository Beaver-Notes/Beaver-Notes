#import <CoreSpotlight/CoreSpotlight.h>
#import <Foundation/Foundation.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#import <dispatch/dispatch.h>
#import "macos_spotlight.h"

static char* copy_string(NSString *s) {
    if (!s) return NULL;
    const char *utf8 = [s UTF8String];
    size_t len = strlen(utf8) + 1;
    char *buf = (char *)malloc(len);
    if (buf) memcpy(buf, utf8, len);
    return buf;
}

static char* run_core_spotlight(void (^block)(void (^resolve)(NSError *))) {
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);
    __block NSError *blockError = nil;

    block(^(NSError *error) {
        blockError = error;
        dispatch_semaphore_signal(sem);
    });

    dispatch_semaphore_wait(sem, DISPATCH_TIME_FOREVER);

    if (blockError) {
        return copy_string(blockError.localizedDescription);
    }
    return NULL;
}

int32_t spotsearch_index_items(const char *json_items, char **out_error) {
    @autoreleasepool {
        NSData *data = [NSData dataWithBytes:json_items length:strlen(json_items)];
        NSError *parseError = nil;
        NSDictionary *dict = [NSJSONSerialization JSONObjectWithData:data options:0 error:&parseError];
        if (parseError || ![dict isKindOfClass:[NSDictionary class]]) {
            if (out_error) *out_error = copy_string(parseError.localizedDescription ?: @"Failed to parse JSON");
            return 1;
        }

        NSArray *items = dict[@"items"];
        if (![items isKindOfClass:[NSArray class]]) {
            if (out_error) *out_error = copy_string(@"Missing 'items' array");
            return 1;
        }

        NSMutableArray<CSSearchableItem *> *searchableItems = [NSMutableArray arrayWithCapacity:items.count];

        for (NSDictionary *item in items) {
            if (![item isKindOfClass:[NSDictionary class]]) continue;

            NSString *uniqueId = item[@"id"];
            NSString *domain = item[@"domain"];
            if (![uniqueId isKindOfClass:[NSString class]] || ![domain isKindOfClass:[NSString class]]) continue;

            CSSearchableItemAttributeSet *attrs = [[CSSearchableItemAttributeSet alloc] initWithContentType:UTTypeText];
            if ([item[@"title"] isKindOfClass:[NSString class]]) attrs.title = item[@"title"];
            if ([item[@"snippet"] isKindOfClass:[NSString class]]) attrs.contentDescription = item[@"snippet"];
            if ([item[@"keywords"] isKindOfClass:[NSArray class]]) attrs.keywords = item[@"keywords"];
            if ([item[@"url"] isKindOfClass:[NSString class]]) attrs.contentURL = [NSURL URLWithString:item[@"url"]];
            if ([item[@"thumbnailBase64"] isKindOfClass:[NSString class]]) {
                NSData *thumbData = [[NSData alloc] initWithBase64EncodedString:item[@"thumbnailBase64"] options:0];
                if (thumbData) attrs.thumbnailData = thumbData;
            }

            CSSearchableItem *si = [[CSSearchableItem alloc] initWithUniqueIdentifier:uniqueId
                                                                    domainIdentifier:domain
                                                                        attributeSet:attrs];
            [searchableItems addObject:si];
        }

        char *err = run_core_spotlight(^(void (^resolve)(NSError *)) {
            [[CSSearchableIndex defaultSearchableIndex] indexSearchableItems:searchableItems completionHandler:resolve];
        });

        if (err) {
            if (out_error) *out_error = err;
            else free(err);
            return 1;
        }
        return 0;
    }
}

int32_t spotsearch_delete_items(const char *json_ids, char **out_error) {
    @autoreleasepool {
        NSData *data = [NSData dataWithBytes:json_ids length:strlen(json_ids)];
        NSError *parseError = nil;
        NSDictionary *dict = [NSJSONSerialization JSONObjectWithData:data options:0 error:&parseError];
        if (parseError || ![dict isKindOfClass:[NSDictionary class]]) {
            if (out_error) *out_error = copy_string(parseError.localizedDescription ?: @"Failed to parse JSON");
            return 1;
        }

        NSArray *ids = dict[@"ids"];
        if (![ids isKindOfClass:[NSArray class]]) {
            if (out_error) *out_error = copy_string(@"Missing 'ids' array");
            return 1;
        }

        char *err = run_core_spotlight(^(void (^resolve)(NSError *)) {
            [[CSSearchableIndex defaultSearchableIndex] deleteSearchableItemsWithIdentifiers:ids completionHandler:resolve];
        });

        if (err) {
            if (out_error) *out_error = err;
            else free(err);
            return 1;
        }
        return 0;
    }
}

int32_t spotsearch_delete_domain(const char *domain, char **out_error) {
    @autoreleasepool {
        NSString *domainStr = [NSString stringWithUTF8String:domain];
        if (!domainStr) {
            if (out_error) *out_error = copy_string(@"Invalid domain string");
            return 1;
        }

        char *err = run_core_spotlight(^(void (^resolve)(NSError *)) {
            [[CSSearchableIndex defaultSearchableIndex] deleteSearchableItemsWithDomainIdentifiers:@[domainStr] completionHandler:resolve];
        });

        if (err) {
            if (out_error) *out_error = err;
            else free(err);
            return 1;
        }
        return 0;
    }
}

void spotsearch_free_error(char *error) {
    if (error) free(error);
}
