<template>
  <ui-modal v-model="show" :content-class="contentClass">
    <!-- Banner: headline, subtext and mascot -->
    <template #header>
      <div
        class="flex items-center justify-between gap-4 rounded-2xl bg-primary/10 px-5 py-4 dark:bg-primary/20"
      >
        <div class="min-w-0">
          <h2
            class="text-xl font-semibold leading-tight tracking-tight text-neutral-900 dark:text-neutral-50"
          >
            {{ headline }}
          </h2>
          <p class="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
            {{ subtext }}
          </p>
        </div>
        <ui-beaver-character
          :state="characterState"
          class="pointer-events-none w-20 shrink-0 md:w-24"
        />
      </div>
    </template>

    <!-- Status line doubles as the polite live region for state changes. -->
    <p
      v-if="visibleNotice"
      class="mb-3 text-sm"
      role="status"
      :class="
        noticeIsError
          ? 'text-red-500'
          : 'text-neutral-600 dark:text-neutral-300'
      "
    >
      {{ visibleNotice }}
    </p>

    <!-- Step 1: inline sign-in, never a dead end -->
    <div v-if="view === 'signing'" class="flex flex-col gap-3">
      <ui-input
        v-model="email"
        type="email"
        :label="tr.emailLabel || 'Email'"
        placeholder="you@example.com"
        autofocus
      />
      <ui-input
        v-model="password"
        :password="true"
        type="password"
        :label="tr.passwordLabel || 'Password'"
        :placeholder="tr.passwordPlaceholder || '••••••••'"
        @keyup.enter="submitSignIn"
      />
      <p v-if="signInError" class="text-sm text-red-500" role="alert">
        {{ signInError }}
      </p>
      <ui-button variant="primary" :loading="signingIn" @click="submitSignIn">
        {{ tr.signInButton || 'Sign in' }}
      </ui-button>
      <button
        type="button"
        class="self-center rounded text-sm text-neutral-500 hover:text-neutral-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-neutral-400 dark:hover:text-neutral-200"
        @click="show = false"
      >
        {{ tr.maybeLater || 'Maybe later' }}
      </button>
      <p
        class="flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400"
      >
        <span class="h-1.5 w-8 rounded-full bg-primary" />
        <span
          class="h-1.5 w-8 rounded-full bg-neutral-200 dark:bg-neutral-700"
        />
        {{ tr.stepOne || 'Step 1 of 2' }}
      </p>
    </div>

    <!-- Loading skeleton -->
    <div v-else-if="loading" class="flex flex-col gap-3" aria-hidden="true">
      <div
        v-for="n in wide ? 3 : 2"
        :key="n"
        class="h-32 animate-pulse rounded-xl bg-neutral-200 dark:bg-neutral-700"
      />
    </div>

    <!-- Store / price error with retry -->
    <div
      v-else-if="loadError"
      class="flex flex-col items-center gap-3 py-6 text-center"
    >
      <p class="text-sm text-red-500">{{ loadError }}</p>
      <ui-button variant="primary" @click="loadPlans">
        {{ tr.retry || 'Try again' }}
      </ui-button>
    </div>

    <!-- Success -->
    <div
      v-else-if="view === 'success'"
      class="flex flex-col items-center gap-3 py-2 text-center"
    >
      <p class="text-sm text-neutral-600 dark:text-neutral-400">
        {{ tr.successBody || 'Restart sync to pick up your new plan limits.' }}
      </p>
      <ui-button variant="primary" class="mt-1" @click="show = false">
        {{ tr.done || 'Done' }}
      </ui-button>
    </div>

    <!-- Plans -->
    <div v-else>
      <!-- Mobile collab: Team is not sold via store billing -->
      <div
        v-if="teamOnlyNote"
        class="rounded-2xl bg-neutral-100 p-4 text-sm dark:bg-neutral-800"
      >
        <p class="font-semibold text-neutral-900 dark:text-neutral-50">
          {{ tr.teamNoteTitle || 'Included with Team' }}
        </p>
        <p class="mt-1 text-neutral-600 dark:text-neutral-300">
          {{
            tr.teamNoteBody ||
            'Shared workspaces come with the Team plan, which you can set up from the desktop app.'
          }}
        </p>
      </div>

      <template v-else>
        <!-- Billing interval -->
        <div class="mb-4 flex flex-wrap items-center gap-3">
          <div
            class="inline-flex rounded-full bg-neutral-100 p-1 text-sm dark:bg-neutral-800"
            role="group"
            :aria-label="tr.intervalLabel || 'Billing interval'"
          >
            <button
              v-for="i in ['monthly', 'yearly']"
              :key="i"
              type="button"
              :aria-pressed="interval === i"
              class="rounded-full px-4 py-1.5 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              :class="
                interval === i
                  ? 'bg-white shadow dark:bg-neutral-700'
                  : 'text-neutral-500 dark:text-neutral-400'
              "
              @click="interval = i"
            >
              {{
                i === 'monthly'
                  ? tr.monthly || 'Monthly'
                  : tr.yearly || 'Yearly'
              }}
            </button>
          </div>
          <span v-if="savePercent > 0" class="text-sm font-medium text-primary">
            {{ savePercent }}% off
          </span>
        </div>

        <!-- Wide viewport: card grid. Cards only select; the CTA buys. -->
        <div
          v-if="wide"
          role="radiogroup"
          :aria-label="tr.plansLabel || 'Plans'"
          class="mt-1 grid gap-2.5"
          :class="isMobile ? 'grid-cols-2' : 'grid-cols-3'"
        >
          <div
            v-for="plan in gridPlans"
            :key="plan"
            role="radio"
            :aria-checked="selected === plan"
            tabindex="0"
            class="relative flex h-full cursor-pointer flex-col gap-1 rounded-2xl border p-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            :class="
              selected === plan
                ? 'border-primary bg-primary/5 ring-1 ring-primary dark:bg-primary/10'
                : 'border-neutral-200 hover:border-neutral-400 dark:border-neutral-700 dark:hover:border-neutral-500'
            "
            @click="selected = plan"
            @keydown.enter.prevent="selected = plan"
            @keydown.space.prevent="selected = plan"
          >
            <span
              v-if="isCurrentPlan(plan)"
              class="absolute -top-2.5 left-3 rounded-full border border-neutral-300 bg-white px-2 py-0.5 text-xs text-neutral-600 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-300"
            >
              {{ tr.currentBadge || 'Current' }}
            </span>

            <p
              class="text-sm font-semibold text-neutral-900 dark:text-neutral-50"
            >
              {{ planLabel(plan) }}
            </p>
            <p
              class="text-lg font-semibold text-neutral-900 dark:text-neutral-50"
            >
              {{ planPriceLine(plan) }}
            </p>
            <p v-if="plan === 'team'" class="text-xs text-neutral-500">
              {{ tr.perSeat || 'per seat / month' }}
            </p>
            <p
              class="mt-1 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
            >
              {{ planFeatures(plan) }}
            </p>
          </div>
        </div>
        <p
          v-if="wide && !isMobile"
          class="mt-3 text-xs text-neutral-500 dark:text-neutral-400"
        >
          {{ tr.vatNote || 'VAT calculated at checkout' }}
        </p>

        <!-- Phone sheet: rows; the selected row expands to show features -->
        <div
          v-if="!wide"
          role="radiogroup"
          :aria-label="tr.plansLabel || 'Plans'"
          class="flex flex-col gap-2.5"
        >
          <ui-card
            v-for="plan in mobilePlans"
            :key="plan"
            :padding="'p-0'"
            hover
            class="transition-colors"
            :class="
              selected === plan ? 'border-primary ring-1 ring-primary' : ''
            "
          >
            <button
              type="button"
              role="radio"
              :aria-checked="selected === plan"
              class="flex w-full items-center justify-between gap-3 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
              @click="selected = plan"
            >
              <span>
                <span
                  class="flex items-center gap-2 text-sm font-medium text-neutral-900 dark:text-neutral-50"
                >
                  {{ planLabel(plan) }}
                  <span
                    v-if="isCurrentPlan(plan)"
                    class="rounded-full border border-neutral-300 px-2 text-[11px] font-normal text-neutral-600 dark:border-neutral-600 dark:text-neutral-300"
                  >
                    {{ tr.currentBadge || 'Current' }}
                  </span>
                </span>
                <span
                  class="mt-0.5 block text-xs text-neutral-500 dark:text-neutral-400"
                >
                  {{ mobilePriceText(plan) }}
                </span>
                <span
                  v-if="selected !== plan"
                  class="mt-0.5 block text-xs text-neutral-400"
                >
                  {{ planFeatures(plan) }}
                </span>
              </span>
              <v-remixicon
                name="riRadioButtonLine"
                class="h-5 w-5 shrink-0"
                :class="selected === plan ? 'text-primary' : 'text-neutral-400'"
              />
            </button>
            <expand-transition>
              <div v-if="selected === plan" class="px-4 pb-4">
                <p
                  class="text-xs leading-relaxed text-neutral-600 dark:text-neutral-300"
                >
                  {{ planFeatures(plan) }}
                </p>
              </div>
            </expand-transition>
          </ui-card>
        </div>
      </template>

      <p
        v-if="busy"
        class="mt-3 text-sm text-neutral-600 dark:text-neutral-300"
        role="status"
      >
        {{
          tr.pendingText ||
          'Activating your plan — this can take up to a minute…'
        }}
      </p>
    </div>

    <!-- Footer: actions, hint, trust line, links -->
    <template #actions>
      <div class="flex w-full flex-col gap-2">
        <template v-if="view === 'plans' && !loading && !loadError">
          <ui-button
            v-if="teamOnlyNote"
            variant="secondary"
            class="w-full"
            @click="show = false"
          >
            {{ tr.gotIt || 'Got it' }}
          </ui-button>
          <div
            v-else
            class="flex gap-2"
            :class="isMobile ? 'flex-col-reverse' : 'items-center gap-3'"
          >
            <ui-button
              type="button"
              variant="default"
              class="w-full"
              @click="show = false"
            >
              {{ tr.maybeLater || 'Maybe later' }}
            </ui-button>
            <ui-button
              variant="primary"
              class="w-full"
              :loading="busy"
              :disabled="busy || !selected || isCurrentPlan(selected)"
              @click="selectPlan(selected)"
            >
              {{ ctaLabel }}
            </ui-button>
          </div>
          <p
            v-if="!isMobile && !teamOnlyNote"
            class="text-center text-xs text-neutral-500 dark:text-neutral-400"
          >
            {{ tr.checkoutHint || 'Checkout opens in your browser' }}
          </p>
        </template>

        <p
          class="flex items-center justify-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400"
        >
          <v-remixicon name="riLockLine" class="h-3.5 w-3.5" />
          {{ tr.encrypted || 'Zero-knowledge encrypted sync' }}
        </p>
        <div
          class="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 py-0.5 text-xs text-neutral-500 dark:text-neutral-400"
        >
          <button
            v-if="isMobile"
            type="button"
            class="underline hover:text-neutral-700 dark:hover:text-neutral-200"
            :disabled="iapBusy"
            @click="restorePurchases"
          >
            {{ tr.restore || 'Restore purchases' }}
          </button>
          <a
            :href="TERMS_URL"
            target="_blank"
            rel="noopener noreferrer"
            class="underline hover:text-neutral-700 dark:hover:text-neutral-200"
          >
            {{ tr.terms || 'Terms' }}
          </a>
          <span aria-hidden="true">·</span>
          <a
            :href="PRIVACY_URL"
            target="_blank"
            rel="noopener noreferrer"
            class="underline hover:text-neutral-700 dark:hover:text-neutral-200"
          >
            {{ tr.privacy || 'Privacy' }}
          </a>
          <!-- Enterprise link: desktop only; mobile has no external purchase links -->
          <template v-if="!isMobile">
            <span aria-hidden="true">·</span>
            <a
              :href="WEBSITE_URL"
              target="_blank"
              rel="noopener noreferrer"
              class="underline hover:text-neutral-700 dark:hover:text-neutral-200"
            >
              {{ tr.enterpriseLink || 'Talk to us about Enterprise' }}
            </a>
          </template>
        </div>
      </div>
    </template>
  </ui-modal>
</template>

<script>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import emitter from 'tiny-emitter/instance';
import { useAccountStore } from '@/store/account';
import { useAccountAuth } from '@/composable/useAccountAuth';
import { useIapBilling } from '@/composable/useIapBilling';
import { useTranslations } from '@/composable/useTranslations';
import { getPlans } from '@/lib/api/plans';
import { createCheckoutSession } from '@/lib/api/billing';
import { PLAN_NAMES, planFeatures, planLabel } from '@/lib/api/types';
import { openBillingUrl } from '@/lib/billing/external-url';

const WEBSITE_URL = 'https://www.beavernotes.com';
const TERMS_URL = `${WEBSITE_URL}/terms`;
const PRIVACY_URL = `${WEBSITE_URL}/privacy`;

// Ordering is the display order.
const DESKTOP_PLANS = [PLAN_NAMES.STARTER, PLAN_NAMES.PRO, PLAN_NAMES.TEAM];
const MOBILE_PLANS = [PLAN_NAMES.STARTER, PLAN_NAMES.PRO];

const REASON_COPY = {
  sync: {
    headline: 'Take your notes with you',
    subtext: 'Use as many devices as you like. Everything is already there.',
  },
  history: {
    headline: 'Every edit, safely kept',
    subtext:
      'Go back to any earlier version of a note whenever you change your mind.',
  },
  collab: {
    headline: 'Write together',
    subtext:
      'Shared workspaces let your team keep notes and edit them together.',
  },
  storage: {
    headline: 'Room for everything',
    subtext:
      'Cloud storage starts at 10 GB, so your notes and attachments are always backed up.',
  },
  settings: {
    headline: 'Choose your plan',
    subtext: 'Upgrade for more storage, longer history and cloud sync.',
  },
};

// Same trust rule Account.vue enforces (shared module {@link '@/lib/billing/external-url'}).

export default {
  name: 'PaywallDialog',
  setup() {
    const accountStore = useAccountStore();
    const { translations } = useTranslations();
    const iap = useIapBilling({ accountStore });
    const isMobile = iap.isMobile;

    // Layout follows the live viewport (rotation/fold aware); the purchase
    // channel follows the runtime (store billing vs browser checkout).
    // Foldables and tablets get the same compact centered modal as an iPad;
    // only phone widths use the bottom sheet.
    const wideMq =
      typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia('(min-width: 768px)')
        : null;
    const wide = ref(!!wideMq?.matches);
    function syncWide(e) {
      wide.value = e.matches;
    }

    const gridPlans = computed(() =>
      wide.value ? (isMobile ? MOBILE_PLANS : DESKTOP_PLANS) : MOBILE_PLANS,
    );
    const contentClass = computed(() => {
      if (!wide.value) return '';
      return isMobile ? 'max-w-lg' : 'max-w-xl';
    });
    function planPriceLine(plan) {
      return isMobile ? mobilePriceText(plan) : planPriceText(plan);
    }

    const show = ref(false);
    const view = ref('plans'); // plans | signing | success
    const interval = ref('monthly');
    const selected = ref(PLAN_NAMES.PRO);
    const reason = ref('settings');
    const prices = ref(null); // desktop prices from GET /plans
    const loading = ref(false);
    const loadError = ref('');
    const busy = ref(false); // checkout / IAP in flight
    const iapBusy = ref(false);
    const notice = ref('');
    const noticeIsError = ref(false);
    const email = ref('');
    const password = ref('');
    const signInError = ref('');
    const signingIn = ref(false);
    const purchasedPlan = ref(null);

    const tr = computed(() => translations.value.paywall || {});
    const trAccount = computed(() => translations.value.account || {});
    const dialogTr = computed(() => translations.value.dialog || {});

    const currentPlan = computed(() =>
      view.value === 'success' && purchasedPlan.value
        ? purchasedPlan.value
        : accountStore.plan,
    );

    const headline = computed(() => {
      if (view.value === 'signing')
        return tr.value.signInHeadline || 'First, a quick sign-in';
      if (view.value === 'success')
        return tr.value.successHeadline || 'You’re all set';
      return (
        tr.value[`headline-${reason.value}`] ||
        REASON_COPY[reason.value]?.headline ||
        REASON_COPY.settings.headline
      );
    });
    const subtext = computed(() => {
      if (view.value === 'signing') {
        return (
          tr.value.signInSubtext || 'So your plan follows you to every device.'
        );
      }
      if (view.value === 'success') {
        return (
          tr.value.successTitle?.replace(
            '{plan}',
            planLabel(currentPlan.value),
          ) ||
          `Subscribed to ${planLabel(currentPlan.value)}. Your plan is now active.`
        );
      }
      return (
        tr.value[`subtext-${reason.value}`] ||
        REASON_COPY[reason.value]?.subtext ||
        REASON_COPY.settings.subtext
      );
    });

    const characterState = computed(() =>
      view.value === 'success' ? 'happy' : 'wink',
    );

    // Team is not sold through store billing, so the collab prompt on
    // mobile explains where to get it instead of showing plans.
    const teamOnlyNote = computed(() => isMobile && reason.value === 'collab');

    const mobilePlans = MOBILE_PLANS;

    function isCurrentPlan(plan) {
      return currentPlan.value === plan;
    }

    function formatAmount(entry) {
      if (!entry || !Number.isFinite(entry.amount) || !entry.currency)
        return '';
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: String(entry.currency).toUpperCase(),
      }).format(entry.amount / 100);
    }

    function desktopPrice(plan, i) {
      return prices.value?.[plan]?.[i] || null;
    }

    function planPriceText(plan) {
      const entry = desktopPrice(plan, interval.value);
      const amount = formatAmount(entry);
      // When the backend has no price configured we show nothing rather
      // than an invented number; the button stays usable.
      return amount
        ? `${amount} / ${interval.value === 'monthly' ? dialogTr.value.monthUnit || 'mo' : dialogTr.value.yearUnit || 'yr'}`
        : '';
    }

    function mobilePriceText(plan) {
      const match = iap.products.value.find(
        (p) => p.productId === `com.beavernotes.${plan}.${interval.value}`,
      );
      return match?.formattedPrice || '';
    }

    // Yearly saving, computed from real prices only — never invented.
    const savePercent = computed(() => {
      for (const plan of [...MOBILE_PLANS, ...DESKTOP_PLANS]) {
        const m = desktopPrice(plan, 'monthly');
        const y = desktopPrice(plan, 'yearly');
        if (m?.amount && y?.amount) {
          const pct = Math.round((1 - y.amount / (m.amount * 12)) * 100);
          if (pct > 0) return pct;
        }
      }
      return 0;
    });

    const ctaLabel = computed(() => {
      if (isCurrentPlan(selected.value))
        return tr.value.currentPlan || 'Current plan';
      if (isMobile) {
        const price = mobilePriceText(selected.value);
        return price
          ? tr.value.subscribeWithPrice || `Subscribe · ${price}`
          : tr.value.subscribeButton || 'Subscribe';
      }
      return (
        tr.value.continueWith?.replace('{plan}', planLabel(selected.value)) ||
        `Continue with ${planLabel(selected.value)}`
      );
    });

    const visibleNotice = computed(() => notice.value || null);

    function setNotice(text, isError = false) {
      notice.value = text;
      noticeIsError.value = isError;
    }

    function resetState() {
      view.value = accountStore.isAuthenticated ? 'plans' : 'signing';
      interval.value = 'monthly';
      selected.value = PLAN_NAMES.PRO;
      notice.value = '';
      noticeIsError.value = false;
      loadError.value = '';
      busy.value = false;
      iapBusy.value = false;
    }

    async function loadPlans() {
      loading.value = true;
      loadError.value = '';
      try {
        if (isMobile) {
          await iap.loadProducts();
          loadError.value = iap.error.value;
        } else {
          const plans = await getPlans({ baseUrl: accountStore.serverUrl });
          // Server reachable but Stripe unconfigured: plans show with no
          // amounts rather than invented numbers.
          prices.value = plans?.prices || null;
        }
      } catch (e) {
        loadError.value =
          e?.message ||
          dialogTr.value.genericError ||
          'Something went wrong. Please try again.';
      } finally {
        loading.value = false;
      }
    }

    async function submitSignIn() {
      signInError.value = '';
      signingIn.value = true;
      try {
        const { signInWithPassword } = useAccountAuth();
        await signInWithPassword(email.value, password.value);
        if (!accountStore.isAuthenticated) {
          throw new Error('Sign in failed. Please try again.');
        }
        view.value = 'plans';
        await loadPlans();
      } catch (e) {
        signInError.value = e?.message || 'Sign in failed. Please try again.';
      } finally {
        signingIn.value = false;
      }
    }

    async function selectPlan(plan) {
      if (view.value === 'success') return;
      if (!accountStore.isAuthenticated) {
        view.value = 'signing';
        return;
      }
      if (!plan) return;
      selected.value = plan;
      if (isMobile) {
        await purchaseMobile(plan);
        return;
      }
      await checkoutDesktop(plan);
    }

    async function purchaseMobile(plan) {
      busy.value = true;
      try {
        const result = await iap.buy(plan, interval.value);
        if (result) {
          purchasedPlan.value = result;
          view.value = 'success';
          setNotice('');
        } else {
          setNotice(
            trAccount.value.iapProcessing ||
              'Payment processing — your plan will activate shortly.',
            false,
          );
        }
      } catch (e) {
        if (/sign in required/i.test(e?.message || '')) {
          view.value = 'signing';
          setNotice('');
        } else {
          setNotice(e?.message || 'Purchase failed. Please try again.', true);
        }
      } finally {
        busy.value = false;
      }
    }

    async function checkoutDesktop(plan) {
      busy.value = true;
      setNotice('');
      try {
        const res = await createCheckoutSession(plan, interval.value, {
          baseUrl: accountStore.serverUrl,
        });
        if (res?.url && (await openBillingUrl(res.url, accountStore.serverUrl))) {
          setNotice(
            tr.value.checkoutOpened ||
              'Checkout opened in your browser. Complete your purchase there.',
          );
        } else {
          setNotice(
            dialogTr.value.checkoutInvalidUrl ||
              'Checkout could not be opened.',
            true,
          );
        }
      } catch (e) {
        if (e?.body?.error === 'EMAIL_NOT_VERIFIED') {
          setNotice(
            trAccount.value.verifyEmail ||
              'Please verify your email before upgrading.',
            true,
          );
        } else {
          setNotice(
            e?.message ||
              dialogTr.value.genericError ||
              'Checkout failed. Please try again.',
            true,
          );
        }
      } finally {
        busy.value = false;
      }
    }

    async function restorePurchases() {
      iapBusy.value = true;
      setNotice('');
      try {
        await iap.restore();
        if (accountStore.isPaidPlan) {
          purchasedPlan.value = accountStore.plan;
          view.value = 'success';
        } else {
          setNotice(
            trAccount.value.noPurchases ||
              'No purchases found for this account.',
            false,
          );
        }
      } catch (e) {
        setNotice(e?.message || 'Restore failed. Please try again.', true);
      } finally {
        iapBusy.value = false;
      }
    }

    function openHandler({ reason: r } = {}) {
      reason.value = REASON_COPY[r] ? r : 'settings';
      resetState();
      if (DESKTOP_PLANS.includes(currentPlan.value)) {
        selected.value = currentPlan.value;
      }
      if (reason.value === 'collab' && !isMobile)
        selected.value = PLAN_NAMES.TEAM;
      // Only a plan whose price is on the displayed grid may stay preselected:
      // the phone/narrow grid shows starter+pro only, and buying 'team' there
      // has no store product (it dies as an error notice).
      if (!gridPlans.value.includes(selected.value))
        selected.value = PLAN_NAMES.PRO;
      show.value = true;
      if (accountStore.isAuthenticated) loadPlans();
    }

    onMounted(() => {
      emitter.on('show-paywall', openHandler);
      wideMq?.addEventListener?.('change', syncWide);
    });
    onUnmounted(() => {
      emitter.off('show-paywall', openHandler);
      wideMq?.removeEventListener?.('change', syncWide);
    });

    watch(show, (v) => {
      if (!v) {
        busy.value = false;
        iapBusy.value = false;
      }
    });

    return {
      WEBSITE_URL,
      TERMS_URL,
      PRIVACY_URL,
      show,
      view,
      interval,
      selected,
      prices,
      loading,
      loadError,
      busy,
      iapBusy,
      isMobile,
      email,
      password,
      signInError,
      signingIn,
      tr,
      trAccount,
      dialogTr,
      currentPlan,
      headline,
      subtext,
      characterState,
      teamOnlyNote,
      ctaLabel,
      wide,
      gridPlans,
      contentClass,
      planPriceLine,
      mobilePlans,
      isCurrentPlan,
      planPriceText,
      mobilePriceText,
      savePercent,
      visibleNotice,
      noticeIsError,
      reason,
      loadPlans,
      submitSignIn,
      selectPlan,
      restorePurchases,
      planLabel,
      planFeatures,
    };
  },
};
</script>
