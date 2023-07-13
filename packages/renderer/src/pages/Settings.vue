<template>
  <div class="container py-6">
    <h1 class="text-3xl mb-10 font-bold">Settings</h1>
    <div class="flex">
      <div class="w-64">
        <ui-list
          class="
            space-y-1
            sticky
            top-10
            mr-8
            rounded-lg
            dark:text-gray-200
            text-gray-600
          "
        >
          <router-link
            v-for="(item, id) in settings"
            v-slot="{ isExactActive }"
            :key="id"
            :to="item.path"
            class="block"
          >
            <ui-list-item :active="isExactActive" class="cursor-pointer">
              <v-remixicon :name="item.icon" class="mr-2 -ml-1" />
              {{ item.name }}
            </ui-list-item>
          </router-link>
        </ui-list>
      </div>
      <router-view />
    </div>
  </div>
</template>
<script setup>
const settings = {
  Settings: {
    name: 'General',
    icon: 'riWindowLine',
    path: '/settings',
    description: '',
  },
  'Settings-Shortcuts': {
    name: 'Shortcuts',
    icon: 'riKeyboardLine',
    path: '/settings/shortcuts',
    description: '',
  },
  'Settings-About': {
    name: 'About',
    icon: 'riInformationLine',
    path: '/settings/about',
    description: '',
  },
};
</script>
