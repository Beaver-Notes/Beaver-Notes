#pragma once
#include <stdint.h>

int32_t spotsearch_index_items(const char *json_items, char **out_error);
int32_t spotsearch_delete_items(const char *json_ids, char **out_error);
int32_t spotsearch_delete_domain(const char *domain, char **out_error);
void spotsearch_free_error(char *error);
