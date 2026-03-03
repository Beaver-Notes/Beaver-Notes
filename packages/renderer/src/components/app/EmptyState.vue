<template>
  <div class="max-h-screen flex items-center justify-center p-10 antialiased">
    <div class="flex flex-col items-center text-center max-w-sm w-full">
      <!-- Mascot -->
      <div class="relative mb-8 flex items-center justify-center w-full h-56">
        <!-- Floating chips -->
        <div
          v-for="chip in chips"
          :key="chip.id"
          class="chip absolute flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-xs font-medium text-neutral-500 dark:text-neutral-400 whitespace-nowrap shadow-sm transition-opacity duration-500"
          :class="[chip.cls, chipsVisible ? 'opacity-100' : 'opacity-0']"
        >
          <span>{{ chip.emoji }}</span
          >{{ chip.text }}
        </div>

        <!-- Mascot SVG -->
        <div class="mascot-float relative z-10">
          <svg
            class="w-44 h-auto drop-shadow-[0_12px_24px_rgba(0,0,0,0.08)]"
            viewBox="0 0 293 280"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M116 217H159V258.5C159 270.374 149.374 280 137.5 280C125.626 280 116 270.374 116 258.5V217Z"
              fill="#EFA432"
            />
            <path
              d="M156 217H199V258.5C199 270.374 189.374 280 177.5 280C165.626 280 156 270.374 156 258.5V217Z"
              fill="#E07C2F"
            />
            <g class="animate-wave" style="transform-origin: 240px 142px">
              <path
                d="M240.853 176.503L216 141.412L249.866 117.426C259.556 110.563 272.975 112.855 279.838 122.545C286.701 132.235 284.409 145.654 274.719 152.517L240.853 176.503Z"
                fill="#E37C2D"
              />
            </g>
            <path
              d="M204.017 19.4287C212.706 8.6985 228.448 7.04391 239.178 15.733C249.908 24.4221 251.563 40.1645 242.874 50.8947L242.357 51.5328C238.767 55.9658 232.264 56.6494 227.831 53.0596L205.027 34.5933C200.594 31.0035 199.91 24.4998 203.5 20.0667L204.017 19.4287Z"
              fill="#B36028"
            />
            <path
              d="M20.5882 151.908C9.21764 132.726 15.55 107.959 34.732 96.5881C53.9139 85.2176 78.6816 91.55 90.0521 110.732L132.109 181.682L62.6454 222.858L20.5882 151.908Z"
              fill="#B55E28"
            />
            <path
              d="M59 96.5C59 44.3091 101.309 2 153.5 2C205.691 2 248 44.3091 248 96.5V198C248 225.614 225.614 248 198 248H59V96.5Z"
              fill="#EFA432"
            />
            <g filter="url(#filter0_d)">
              <path
                d="M58.9625 177.42L101.963 177.393L102.006 247.487C102.014 259.361 92.3939 268.993 80.5197 269C68.6456 269.008 59.0137 259.388 59.0063 247.514L58.9625 177.42Z"
                fill="#EFA431"
              />
            </g>
            <path
              d="M65.7263 50.9254C57.0372 40.1952 58.6918 24.4528 69.4219 15.7637C80.1521 7.07459 95.8945 8.72919 104.584 19.4593L105.1 20.0974C108.69 24.5304 108.007 31.0342 103.574 34.624L80.7696 53.0902C76.3366 56.68 69.8328 55.9965 66.243 51.5634L65.7263 50.9254Z"
              fill="#B36028"
            />
            <rect
              x="130"
              y="159"
              width="107"
              height="83"
              rx="41.5"
              fill="#FAE3B7"
            />
            <rect
              x="182"
              y="223.761"
              width="16.6588"
              height="2.37983"
              transform="rotate(-50 182 223.761)"
              fill="#EFA432"
            />
            <rect
              x="183.823"
              y="211"
              width="16.6588"
              height="2.37983"
              transform="rotate(50 183.823 211)"
              fill="#EFA432"
            />
            <rect x="122" y="62" width="15" height="10" rx="5" fill="#B75C25" />
            <rect x="186" y="62" width="15" height="10" rx="5" fill="#B75C25" />
            <ellipse cx="130" cy="88" rx="8" ry="11" fill="#562001" />
            <ellipse cx="194" cy="88" rx="8" ry="11" fill="#562001" />
            <path
              d="M158 121H169V128.5C169 131.538 166.538 134 163.5 134C160.462 134 158 131.538 158 128.5V121Z"
              fill="#FBFCFF"
            />
            <path
              d="M169 121H180V128.5C180 131.538 177.538 134 174.5 134C171.462 134 169 131.538 169 128.5V121Z"
              fill="#FBFCFF"
            />
            <rect
              x="138"
              y="105"
              width="62"
              height="20"
              rx="10"
              fill="#FAE5B8"
            />
            <path
              d="M160 106.333C160 103.94 161.94 102 164.333 102H173.667C176.06 102 178 103.94 178 106.333C178 111.12 174.12 115 169.333 115H168.667C163.88 115 160 111.12 160 106.333Z"
              fill="#B45F28"
            />
            <defs>
              <filter
                id="filter0_d"
                x="58.9625"
                y="177.393"
                width="45.0438"
                height="91.6074"
                filterUnits="userSpaceOnUse"
                color-interpolation-filters="sRGB"
              >
                <feFlood flood-opacity="0" result="BackgroundImageFix" />
                <feColorMatrix
                  in="SourceAlpha"
                  type="matrix"
                  values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
                  result="hardAlpha"
                />
                <feOffset dx="2" />
                <feComposite in2="hardAlpha" operator="out" />
                <feColorMatrix
                  type="matrix"
                  values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.1 0"
                />
                <feBlend
                  mode="normal"
                  in2="BackgroundImageFix"
                  result="effect1_dropShadow"
                />
                <feBlend
                  mode="normal"
                  in="SourceGraphic"
                  in2="effect1_dropShadow"
                  result="shape"
                />
              </filter>
            </defs>
          </svg>
        </div>

        <!-- Ground shadow -->
        <div
          class="mascot-shadow absolute bottom-1 left-1/2 w-20 h-2.5 rounded-full bg-black/[0.06] dark:bg-white/[0.04]"
        />
      </div>

      <!-- Text -->
      <h1
        class="text-2xl font-bold text-neutral-800 dark:text-neutral-100 mb-2 leading-snug"
      >
        {{ translations.emptyState?.heading || 'Ready to capture your ideas?' }}
      </h1>
      <p
        class="text-sm text-neutral-500 dark:text-neutral-400 mb-7 leading-relaxed"
      >
        {{
          translations.emptyState?.subheading ||
          'Start a new note, organize your thoughts, or just jot something down.'
        }}
      </p>

      <!-- CTA -->
      <ui-button variant="primary" @click="handleCreate">
        <v-remixicon name="riAddFill" size="24" />
        <span>{{
          translations.emptyState?.createCta || 'Create Your First Note'
        }}</span>
      </ui-button>

      <!-- Shortcuts -->
      <div class="flex items-center justify-center mt-4 gap-4 flex-wrap">
        <div
          v-for="sc in shortcuts"
          :key="sc.id"
          class="flex items-center gap-1.5 text-xs text-neutral-400 dark:text-neutral-500"
        >
          <span
            v-for="k in sc.keys"
            :key="k"
            class="inline-flex items-center justify-center min-w-[24px] px-1.5 py-0.5 bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded text-[11px] font-semibold text-neutral-500 dark:text-neutral-400 shadow-[0_1px_0_theme(colors.neutral.200)] dark:shadow-[0_1px_0_theme(colors.neutral.700)]"
            >{{ k }}</span
          >
          <span>{{ sc.label }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted } from 'vue';
import { useTranslations } from '@/composable/useTranslations';

const chipsVisible = ref(false);
const { translations } = useTranslations();

const isMac = /Mac|iPhone/i.test(navigator.platform);
const cmdKey = isMac ? '⌘' : 'Ctrl';

const chips = computed(() => [
  {
    id: 1,
    cls: 'chip-1',
    emoji: '✍️',
    text: translations.value.emptyState?.chipWrite || 'Write something',
  },
  {
    id: 2,
    cls: 'chip-2',
    emoji: '💡',
    text: translations.value.emptyState?.chipCapture || 'Capture ideas',
  },
  {
    id: 3,
    cls: 'chip-3',
    emoji: '📋',
    text: translations.value.emptyState?.chipMeeting || 'Meeting notes',
  },
]);

const shortcuts = computed(() => [
  {
    id: 1,
    keys: [cmdKey, 'N'],
    label: translations.value.emptyState?.shortcutNewNote || 'New note',
  },
  {
    id: 2,
    keys: [cmdKey, '⇧', 'F'],
    label: translations.value.emptyState?.shortcutNewFolder || 'New folder',
  },
]);

onMounted(() => {
  setTimeout(() => (chipsVisible.value = true), 400);
});

const emit = defineEmits(['create']);
const handleCreate = () => emit('create');
</script>

<style scoped>
/* Mascot float */
.mascot-float {
  animation: mascotFloat 5s ease-in-out infinite;
}

/* Ground shadow synced to float */
.mascot-shadow {
  animation: shadowPulse 5s ease-in-out infinite;
}

/* Waving arm */
.animate-wave {
  animation: wave 2s ease-in-out infinite;
}

/* Chip positions + floats */
.chip-1 {
  top: 12px;
  right: 24px;
  animation: chipFloat1 4s ease-in-out infinite;
  transition-delay: 0s;
}
.chip-2 {
  top: 48px;
  left: 12px;
  animation: chipFloat2 4.5s ease-in-out infinite;
  transition-delay: 0.25s;
}
.chip-3 {
  bottom: 40px;
  right: 8px;
  animation: chipFloat3 3.8s ease-in-out infinite;
  transition-delay: 0.5s;
}

@keyframes mascotFloat {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-10px);
  }
}
@keyframes shadowPulse {
  0%,
  100% {
    transform: translateX(-50%) scaleX(1);
    opacity: 1;
  }
  50% {
    transform: translateX(-50%) scaleX(0.6);
    opacity: 0.4;
  }
}
@keyframes wave {
  0%,
  100% {
    transform: rotate(0deg);
  }
  25% {
    transform: rotate(-15deg);
  }
  50% {
    transform: rotate(-5deg);
  }
  75% {
    transform: rotate(-15deg);
  }
}
@keyframes chipFloat1 {
  0%,
  100% {
    transform: translate(0, 0);
  }
  50% {
    transform: translate(-3px, -7px);
  }
}
@keyframes chipFloat2 {
  0%,
  100% {
    transform: translate(0, 0);
  }
  50% {
    transform: translate(4px, -6px);
  }
}
@keyframes chipFloat3 {
  0%,
  100% {
    transform: translate(0, 0);
  }
  50% {
    transform: translate(-4px, -8px);
  }
}
</style>
