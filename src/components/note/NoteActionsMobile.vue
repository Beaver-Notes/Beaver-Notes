<template>
  <div
    ref="container"
    class="bg-white dark:bg-neutral-800 overflow-x-auto z-20 p-1 sticky no-print justify-between"
  >
    <button
      class="hoverable h-8 px-1 rounded-lg transition-colors flex items-center"
    >
      <v-remixicon name="riArrowLeftLine" size="25" />
    </button>
    <div class="flex">
      <button
        class="hoverable h-8 px-1 rounded-lg transition-colors flex items-center"
      >
        <v-remixicon name="riShare2Line" size="25" />
      </button>
      <button
        class="hoverable h-8 px-1 rounded-lg transition-colors flex items-center"
      >
        <v-remixicon name="riArticleLine" size="25" />
      </button>
      <button
        class="hoverable h-8 px-1 rounded-lg transition-colors flex items-center"
      >
        <v-remixicon name="riSearchLine" size="25" />
      </button>
    </div>
  </div>
</template>
