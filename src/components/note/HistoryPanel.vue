<template>
  <transition name="slide-up">
    <div
      class="fixed inset-x-0 z-40 mx-2 transition-all duration-300 ease-[var(--ease-standard)] bottom-4 md:pl-16"
    >
      <div
        class="relative bg-white dark:bg-neutral-900 border rounded-xl shadow-lg overflow-hidden w-full max-w-4xl mx-auto"
      >
        <!-- Desktop Layout -->
        <div v-if="tab === 'history'" class="max-md:hidden">
          <div class="flex items-center justify-between px-4 py-2 border-b border-neutral-200 dark:border-neutral-700">
            <div class="flex items-center gap-3">
              <h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                {{ tr.noteHistory || 'Note History' }}
              </h3>
              <span v-if="filteredCommits.length" class="text-xs text-neutral-400 dark:text-neutral-500">
                {{ fmt('lastEdited', { time: relativeTime(filteredCommits[0]?.createdAt) }) }}
              </span>
            </div>
            <div class="flex items-center gap-2">
              <select
                :value="history.timeFilter.value"
                @change="history.setFilter($event.target.value)"
                class="text-xs border border-neutral-200 dark:border-neutral-600 rounded-md px-2 py-1 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                <option value="all">{{ tr.all || 'All' }}</option>
                <option value="today">{{ tr.today || 'Today' }}</option>
                <option value="week">{{ tr.thisWeek || 'This Week' }}</option>
              </select>
              <button
                @click="tab = 'activity'"
                class="text-xs font-medium border border-neutral-200 dark:border-neutral-600 rounded-md px-2 py-1 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
              >
                {{ tr.activity || 'Activity' }}
              </button>
              <button
                @click="$emit('close')"
                class="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors p-1 rounded"
              >
                <v-remixicon name="riCloseLine" class="w-4 h-4" />
              </button>
            </div>
          </div>

          <div v-if="history.loading.value && !filteredCommits.length" class="flex items-center justify-center py-12">
            <div class="flex flex-col items-center gap-3">
              <div class="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
              <span class="text-sm text-neutral-500">{{ tr.loading || 'Loading history...' }}</span>
            </div>
          </div>

          <div v-else-if="history.error.value" class="flex items-center justify-center py-12 px-6">
            <div class="text-center">
              <p class="text-sm text-red-600 dark:text-red-400">{{ history.error.value }}</p>
            </div>
          </div>

          <div v-else-if="!filteredCommits.length" class="flex items-center justify-center py-12 px-6">
            <div class="text-center">
              <p class="text-sm text-neutral-500">{{ tr.noHistory || 'No history available' }}</p>
            </div>
          </div>

          <div v-else class="flex overflow-hidden">
            <div class="flex-1 p-4 min-h-[220px]">
              <div class="relative w-full h-full min-h-[180px]">
                                <div class="absolute left-0 top-0 bottom-6 w-8 flex flex-col justify-between text-xs text-neutral-400 dark:text-neutral-500 pr-1">
                  <span>6AM</span>
                  <span>2PM</span>
                  <span>10PM</span>
                </div>
                                <div class="ml-8 relative h-[calc(100%-24px)] border-b border-l border-neutral-200 dark:border-neutral-700">
                  <div class="absolute inset-0 flex flex-col justify-between pointer-events-none">
                    <div class="border-t border-dashed border-neutral-200 dark:border-neutral-700 w-full h-0" style="top: 25%"></div>
                    <div class="border-t border-dashed border-neutral-200 dark:border-neutral-700 w-full h-0" style="top: 50%"></div>
                    <div class="border-t border-dashed border-neutral-200 dark:border-neutral-700 w-full h-0" style="top: 75%"></div>
                  </div>
                  <div
                    v-for="(commit, idx) in filteredCommits"
                    :key="commit.hash"
                    class="absolute w-2.5 h-2.5 rounded-full cursor-pointer transition-all duration-200 hover:scale-150 z-10"
                    :class="[
                      idx === history.selectedCommitIndex.value
                        ? 'bg-neutral-900 dark:bg-white ring-2 ring-neutral-900/30 dark:ring-white/30'
                        : 'bg-emerald-500 hover:bg-emerald-600',
                    ]"
                    :style="{
                      left: dotPosition(commit).x + '%',
                      top: dotPosition(commit).y + '%',
                      transform: 'translate(-50%, -50%)',
                    }"
                    @mouseenter="history.selectCommit(idx)"
                    @click="onDotClick(commit, idx)"
                  ></div>
                </div>
                <div class="ml-8 mt-1 flex justify-between text-xs text-neutral-400 dark:text-neutral-500">
                  <span>{{ dateRangeLabel.min }}</span>
                  <span v-if="dateRangeLabel.mid">{{ dateRangeLabel.mid }}</span>
                  <span>{{ dateRangeLabel.max }}</span>
                </div>
              </div>
            </div>

            <transition
              enter-active-class="transition-all duration-200 ease-out"
              enter-from-class="translate-x-4 opacity-0"
              enter-to-class="translate-x-0 opacity-100"
              leave-active-class="transition-[transform,opacity] duration-150 ease-out"
              leave-from-class="translate-x-0 opacity-100"
              leave-to-class="translate-x-4 opacity-0"
            >
              <div
                v-if="history.selectedCommitIndex.value >= 0 && selectedCommitData"
                class="w-72 border-l border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-850 flex flex-col overflow-auto"
              >
                <div class="p-3 space-y-3">
                  <div class="flex items-center justify-between">
                    <div>
                      <p class="text-xs text-neutral-500 dark:text-neutral-400">{{ tr.version || 'Version' }}</p>
                      <p class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                        {{ filteredCommits.length - history.selectedCommitIndex.value }}
                      </p>
                    </div>
                    <button
                      @click="history.clearSelection(); $emit('preview', null)"
                      class="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 p-1"
                    >
                      <v-remixicon name="riCloseLine" class="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div>
                    <p class="text-xs text-neutral-500 dark:text-neutral-400">{{ tr.timestamp || 'Timestamp' }}</p>
                    <p class="text-xs text-neutral-700 dark:text-neutral-300">
                      {{ formatDateTime(selectedCommitData.createdAt) }}
                    </p>
                  </div>
                  <div class="flex gap-4">
                    <div>
                      <p class="text-xs text-neutral-500 dark:text-neutral-400">{{ tr.words || 'Words' }}</p>
                      <p class="text-xs font-medium text-neutral-900 dark:text-neutral-100">
                        {{ wordCount.toLocaleString() }}
                      </p>
                    </div>
                    <div v-if="wordDiff !== null">
                      <p class="text-xs text-neutral-500 dark:text-neutral-400">{{ tr.change || 'Change' }}</p>
                      <p
                        class="text-xs font-medium"
                        :class="wordDiff > 0 ? 'text-emerald-600 dark:text-emerald-400' : wordDiff < 0 ? 'text-red-600 dark:text-red-400' : 'text-neutral-500'"
                      >
                        {{ wordDiff > 0 ? '+' : '' }}{{ wordDiff.toLocaleString() }}
                      </p>
                    </div>
                  </div>
                  <div v-if="snippet">
                    <p class="text-xs text-neutral-500 dark:text-neutral-400 mb-0.5">{{ tr.preview || 'Preview' }}</p>
                    <p class="text-xs text-neutral-600 dark:text-neutral-400 line-clamp-2 leading-relaxed">
                      {{ snippet }}
                    </p>
                  </div>
                  <div v-if="selectedCommitData.authorName">
                    <p class="text-xs text-neutral-500 dark:text-neutral-400">{{ tr.author || 'Author' }}</p>
                    <p class="text-xs text-neutral-700 dark:text-neutral-300">
                      {{ selectedCommitData.authorName }}
                    </p>
                  </div>
                  <div class="flex gap-2 pt-1">
                    <button
                      @click="togglePreview"
                      class="flex-1 px-2 py-1.5 text-xs font-medium rounded-lg border border-neutral-200 dark:border-neutral-600 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                    >
                      {{ showPreview ? (tr.hide || 'Hide') : (tr.preview || 'Preview') }}
                    </button>
                    <button
                    @click="$emit('restore', { ...selectedCommitData, ...(history.selectedCommit.value || {}) })"
                      class="flex-1 px-2 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                    >
                      {{ tr.restore || 'Restore' }}
                    </button>
                  </div>
                  <button
                    @click="reviewCommit"
                    class="w-full px-2 py-1.5 text-xs font-medium rounded-lg border border-emerald-600 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 transition-colors"
                  >
                    {{ tr.reviewChanges || 'Review changes' }}
                  </button>
                </div>
                <div
                  v-if="showPreview"
                  class="border-t border-neutral-200 dark:border-neutral-700 p-3 max-h-[25vh] overflow-auto"
                >
                  <div ref="previewEditorEl" class="prose prose-sm dark:prose-invert max-w-none"></div>
                </div>
              </div>
            </transition>
          </div>

          <div v-if="filteredCommits.length" class="border-t border-neutral-200 dark:border-neutral-700 px-4 py-2">
            <div class="flex items-center gap-3">
              <button
                @click="rotateWheel(-40)"
                class="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors px-1"
              >
                <v-remixicon name="riArrowLeftSLine" class="w-4 h-4" />
              </button>
              <div class="flex-1 overflow-hidden">
                <div class="text-center mb-0.5">
                  <span class="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                    {{ activeDateLabel }}
                  </span>
                </div>
                <div
                  ref="rotaryContainer"
                  class="relative h-6 cursor-grab active:cursor-grabbing"
                  @mousedown="onDragStart"
                  @wheel.prevent="onWheel"
                >
                  <svg class="w-full h-full" :viewBox="`0 0 ${wheelTickCount * 12} 24`" preserveAspectRatio="none">
                    <line
                      v-for="i in wheelTickCount"
                      :key="i"
                      :x1="i * 12 - 6"
                      y1="4"
                      :x2="i * 12 - 6"
                      :y2="getTickHeight(i)"
                      :stroke="isTickActive(i) ? '#059669' : '#d1d5db'"
                      :stroke-width="isTickActive(i) ? 2 : 1"
                      stroke-linecap="round"
                    />
                  </svg>
                  <div class="absolute left-1/2 top-0 -translate-x-1/2 w-0.5 h-full bg-emerald-500 rounded-full"></div>
                </div>
              </div>
              <button
                @click="rotateWheel(40)"
                class="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors px-1"
              >
                <v-remixicon name="riArrowRightSLine" class="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        <!-- Mobile Layout -->
        <div v-if="tab === 'history'" class="hidden max-md:block">
          <div class="flex items-center justify-between px-3 py-2 border-b border-neutral-200 dark:border-neutral-700">
            <div class="flex items-center gap-2">
              <h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                {{ tr.history || 'History' }}
              </h3>
              <span class="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs font-medium text-emerald-700 bg-emerald-100 dark:text-emerald-300 dark:bg-emerald-900/40 rounded-full">
                <span class="w-1 h-1 rounded-full bg-emerald-500"></span>
                {{ tr.auto || 'Auto' }}
              </span>
            </div>
            <div class="flex items-center gap-1.5">
              <select
                :value="history.timeFilter.value"
                @change="history.setFilter($event.target.value)"
                class="text-xs border border-neutral-200 dark:border-neutral-600 rounded px-1.5 py-0.5 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300"
              >
                <option value="all">{{ tr.all || 'All' }}</option>
                <option value="today">{{ tr.today || 'Today' }}</option>
                <option value="week">{{ tr.week || 'Week' }}</option>
              </select>
              <button
                @click="tab = 'activity'"
                class="text-xs border border-neutral-200 dark:border-neutral-600 rounded px-1.5 py-0.5 text-neutral-700 dark:text-neutral-300"
              >
                {{ tr.activity || 'Activity' }}
              </button>
              <button
                @click="$emit('close')"
                class="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 p-1"
              >
                <v-remixicon name="riCloseLine" class="w-4 h-4" />
              </button>
            </div>
          </div>

          <div v-if="history.loading.value && !filteredCommits.length" class="flex items-center justify-center py-8">
            <div class="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
          </div>

          <div v-else-if="history.error.value" class="flex items-center justify-center py-8 px-4">
            <p class="text-sm text-red-600 dark:text-red-400 text-center">{{ history.error.value }}</p>
          </div>

          <div v-else-if="!filteredCommits.length" class="flex items-center justify-center py-8 px-4">
            <p class="text-sm text-neutral-500">{{ tr.noHistory || 'No history available' }}</p>
          </div>

          <div v-else>
            <div class="px-3 pt-3">
              <div class="relative w-full h-24">
                <div class="absolute left-0 top-0 bottom-4 w-6 flex flex-col justify-between text-[8px] text-neutral-400 dark:text-neutral-500">
                  <span>6A</span>
                  <span>2P</span>
                  <span>10P</span>
                </div>
                <div class="ml-6 relative h-[calc(100%-16px)] border-b border-l border-neutral-200 dark:border-neutral-700">
                  <div
                    v-for="(commit, idx) in filteredCommits"
                    :key="commit.hash"
                    class="absolute w-2 h-2 rounded-full cursor-pointer transition-all duration-200 active:scale-150 z-10"
                    :class="[
                      idx === history.selectedCommitIndex.value
                        ? 'bg-neutral-900 dark:bg-white ring-2 ring-neutral-900/30 dark:ring-white/30'
                        : 'bg-emerald-500',
                    ]"
                    :style="{
                      left: dotPosition(commit).x + '%',
                      top: dotPosition(commit).y + '%',
                      transform: 'translate(-50%, -50%)',
                    }"
                    @touchstart.stop="onDotClick(commit, idx)"
                    @click="onDotClick(commit, idx)"
                  ></div>
                </div>
                <div class="ml-6 mt-0.5 flex justify-between text-[8px] text-neutral-400 dark:text-neutral-500">
                  <span>{{ dateRangeLabel.min }}</span>
                  <span>{{ dateRangeLabel.max }}</span>
                </div>
              </div>
            </div>

            <div
              :class="[
                'transition-[max-height,opacity] duration-200 ease-in-out overflow-hidden',
                history.selectedCommitIndex.value >= 0 && selectedCommitData
                  ? 'max-h-60 opacity-100'
                  : 'max-h-0 opacity-0',
              ]"
            >
              <div v-if="selectedCommitData" class="border-t border-neutral-200 dark:border-neutral-700 p-3 space-y-2">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-3">
                    <div>
                      <p class="text-xs text-neutral-500 dark:text-neutral-400">{{ tr.version || 'Version' }}</p>
                      <p class="text-xs font-semibold text-neutral-900 dark:text-neutral-100">
                        {{ filteredCommits.length - history.selectedCommitIndex.value }}
                      </p>
                    </div>
                    <div>
                      <p class="text-xs text-neutral-500 dark:text-neutral-400">{{ tr.words || 'Words' }}</p>
                      <p class="text-xs font-medium text-neutral-900 dark:text-neutral-100">
                        {{ wordCount.toLocaleString() }}
                      </p>
                    </div>
                    <div v-if="wordDiff !== null">
                      <p class="text-xs text-neutral-500 dark:text-neutral-400">{{ tr.change || 'Change' }}</p>
                      <p
                        class="text-xs font-medium"
                        :class="wordDiff > 0 ? 'text-emerald-600 dark:text-emerald-400' : wordDiff < 0 ? 'text-red-600 dark:text-red-400' : 'text-neutral-500'"
                      >
                        {{ wordDiff > 0 ? '+' : '' }}{{ wordDiff.toLocaleString() }}
                      </p>
                    </div>
                  </div>
                  <button
                    @click="history.clearSelection(); $emit('preview', null)"
                    class="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 p-1"
                  >
                    <v-remixicon name="riCloseLine" class="w-3.5 h-3.5" />
                  </button>
                </div>
                <p class="text-xs text-neutral-500 dark:text-neutral-400">
                  {{ formatDateTime(selectedCommitData.createdAt) }}
                </p>
                <div v-if="snippet" class="text-xs text-neutral-600 dark:text-neutral-400 line-clamp-2">
                  {{ snippet }}
                </div>
                <div class="flex gap-2">
                  <button
                    @click="togglePreview"
                    class="flex-1 px-2 py-1.5 text-xs font-medium rounded-lg border border-neutral-200 dark:border-neutral-600 text-neutral-700 dark:text-neutral-300"
                  >
                    {{ showPreview ? (tr.hide || 'Hide') : (tr.preview || 'Preview') }}
                  </button>
                  <button
                    @click="$emit('restore', { ...selectedCommitData, ...(history.selectedCommit.value || {}) })"
                    class="flex-1 px-2 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 text-white"
                  >
                    {{ tr.restore || 'Restore' }}
                  </button>
                </div>
                <button
                  @click="reviewCommit"
                  class="w-full px-2 py-1.5 text-xs font-medium rounded-lg border border-emerald-600 text-emerald-700 dark:text-emerald-300"
                >
                  {{ tr.reviewChanges || 'Review changes' }}
                </button>
                <div
                  v-if="showPreview"
                  class="border-t border-neutral-200 dark:border-neutral-700 pt-2 max-h-[20vh] overflow-auto"
                >
                  <div ref="previewEditorEl" class="prose prose-xs dark:prose-invert max-w-none"></div>
                </div>
              </div>
            </div>

            <div v-if="filteredCommits.length" class="border-t border-neutral-200 dark:border-neutral-700 px-3 py-2">
              <div class="flex items-center gap-2">
                <button
                  @click="rotateWheel(-40)"
                  class="text-neutral-400 p-0.5"
                >
                  <v-remixicon name="riArrowLeftSLine" class="w-3.5 h-3.5" />
                </button>
                <div class="flex-1 overflow-hidden">
                  <div class="text-center mb-0.5">
                    <span class="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                      {{ activeDateLabel }}
                    </span>
                  </div>
                  <div
                    class="relative h-5 cursor-grab active:cursor-grabbing"
                    @touchstart="onTouchStart"
                    @touchmove.prevent="onTouchMove"
                    @wheel.prevent="onWheel"
                  >
                    <svg class="w-full h-full" :viewBox="`0 0 ${wheelTickCount * 10} 20`" preserveAspectRatio="none">
                      <line
                        v-for="i in wheelTickCount"
                        :key="i"
                        :x1="i * 10 - 5"
                        y1="4"
                        :x2="i * 10 - 5"
                        :y2="getTickHeight(i)"
                        :stroke="isTickActive(i) ? '#059669' : '#d1d5db'"
                        :stroke-width="isTickActive(i) ? 2 : 1"
                        stroke-linecap="round"
                      />
                    </svg>
                    <div class="absolute left-1/2 top-0 -translate-x-1/2 w-0.5 h-full bg-emerald-500 rounded-full"></div>
                  </div>
                </div>
                <button
                  @click="rotateWheel(40)"
                  class="text-neutral-400 p-0.5"
                >
                  <v-remixicon name="riArrowRightSLine" class="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Activity -->
        <div v-else>
          <div class="flex items-center justify-between px-4 py-2 border-b border-neutral-200 dark:border-neutral-700">
            <div class="flex items-center gap-3">
              <h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                {{ tr.activity || 'Activity' }}
              </h3>
              <span
                v-if="activity.entries.value.length"
                class="text-xs text-neutral-400 dark:text-neutral-500"
              >
                {{ activity.entries.value.length }}
              </span>
            </div>
            <div class="flex items-center gap-2">
              <button
                v-if="activity.entries.value.length"
                @click="confirmClearActivity"
                class="text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 px-2 py-1 rounded transition-colors"
              >
                {{ tr.clearActivity || 'Clear activity' }}
              </button>
              <button
                @click="tab = 'history'"
                class="text-xs border border-neutral-200 dark:border-neutral-600 rounded-md px-2 py-1 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
              >
                {{ tr.history || 'History' }}
              </button>
              <button
                @click="$emit('close')"
                class="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 p-1 rounded transition-colors"
              >
                <v-remixicon name="riCloseLine" class="w-4 h-4" />
              </button>
            </div>
          </div>

          <div
            v-if="activity.loading.value && !activity.entries.value.length"
            class="flex items-center justify-center py-12"
          >
            <div class="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
          </div>

          <div
            v-else-if="activity.error.value"
            class="flex items-center justify-center py-12 px-6"
          >
            <p class="text-sm text-red-600 dark:text-red-400 text-center">
              {{ activity.error.value }}
            </p>
          </div>

          <div
            v-else-if="!activity.entries.value.length"
            class="flex items-center justify-center py-12 px-6"
          >
            <p class="text-sm text-neutral-500">
              {{ tr.noActivity || 'No activity yet' }}
            </p>
          </div>

          <div v-else class="max-h-[45vh] overflow-auto px-4 py-2">
            <template v-for="group in activityGroups" :key="group.day">
              <p class="text-[11px] font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500 mt-2 mb-1">
                {{ group.label }}
              </p>
              <div
                v-for="entry in group.items"
                :key="entry.id"
                class="flex items-start gap-3 py-2 border-b border-neutral-100 dark:border-neutral-800 last:border-b-0"
              >
                <div class="flex-1 min-w-0">
                  <p class="text-xs text-neutral-700 dark:text-neutral-300">
                    <span class="font-medium">{{ entry.actorLabel }}</span>
                    {{ activityVerb(entry.kind) }}
                    <span v-if="entry.summary" class="text-neutral-500 dark:text-neutral-400">
                      &ldquo;{{ entry.summary }}&rdquo;
                    </span>
                  </p>
                  <p class="text-[11px] text-neutral-400 dark:text-neutral-500 mt-0.5">
                    {{ relativeTime(new Date(entry.at).toISOString()) }}
                  </p>
                </div>
                <div class="flex items-center gap-1 shrink-0">
                  <button
                    @click="jumpTo(entry)"
                    :disabled="!canJump(entry)"
                    class="text-[11px] font-medium px-2 py-1 rounded-md border border-neutral-200 dark:border-neutral-600 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                  >
                    {{ tr.jumpTo || 'Jump to' }}
                  </button>
                  <button
                    @click="undoActivity(entry)"
                    :disabled="!activity.canUndo(entry)"
                    class="text-[11px] font-medium px-2 py-1 rounded-md border border-emerald-500 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                  >
                    {{ tr.undo || 'Undo' }}
                  </button>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>

<script>
import { ref, computed, onMounted, nextTick, onBeforeUnmount, watch } from 'vue';
import { useNoteHistory } from '@/composable/useNoteHistory';
import { useActivityLog } from '@/composable/useActivityLog';
import { useDialog } from '@/lib/dialog';
import { useTranslations } from '@/composable/useTranslations';

export default {
  props: {
    noteId: { type: String, required: true },
    workspaceId: { type: String, default: '' },
    editor: { type: Object, default: null },
  },
  emits: ['close', 'restore', 'preview', 'review'],
  setup(props) {
    const history = useNoteHistory();
    const activity = useActivityLog();
    const dialog = useDialog();
    const { translations } = useTranslations();
    const tr = computed(() => translations.value?.history || {});
    const tab = ref('history');
    function fmt(key, params) {
      const raw = tr.value[key] ?? key;
      if (!params) return raw;
      return Object.entries(params).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), raw);
    }
    const showPreview = ref(false);
    const previewEditorEl = ref(null);
    const rotaryContainer = ref(null);
    const wheelOffset = ref(0);
    let previewEditor = null;

    // Scatter chart
    function dotPosition(commit) {
      const d = new Date(commit.createdAt);
      const hours = d.getHours() + d.getMinutes() / 60;
      const y = (hours / 24) * 100;
      const commits = history.filteredCommits.value;
      if (commits.length <= 1) return { x: 50, y };
      const timestamps = commits.map((c) => new Date(c.createdAt).getTime());
      const minTs = Math.min(...timestamps);
      const maxTs = Math.max(...timestamps);
      const range = maxTs - minTs || 1;
      const x = ((d.getTime() - minTs) / range) * 80 + 10;
      return { x, y };
    }

    const dateRangeLabel = computed(() => {
      const commits = history.filteredCommits.value;
      if (!commits.length) return { min: '', mid: '', max: '' };
      const timestamps = commits.map((c) => new Date(c.createdAt).getTime());
      const minTs = Math.min(...timestamps);
      const maxTs = Math.max(...timestamps);
      const min = formatShortDate(new Date(minTs));
      const max = formatShortDate(new Date(maxTs));
      const mid = minTs !== maxTs ? formatShortDate(new Date((minTs + maxTs) / 2)) : '';
      return { min, mid, max };
    });

    function formatShortDate(d) {
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }

    async function onDotClick(commit, idx) {
      history.selectCommit(idx);
      await history.loadSnapshot(commit.hash, props.noteId);
      const snapshot = history.selectedCommit.value;
      $emit(
        'preview',
        snapshot?.content
          ? { ...snapshot, hash: commit.hash, createdAt: commit.createdAt }
          : null
      );
    }

    // Hovering a dot only selects it, so hovering then clicking "Review changes"
    // would still need the snapshot fetched. Load it here to guarantee a
    // baseline before opening the review.
    async function reviewCommit() {
      const commit = selectedCommitData.value;
      if (!commit?.hash) return;
      await history.loadSnapshot(commit.hash, props.noteId);
      const snapshot = history.selectedCommit.value;
      if (!snapshot?.content) return;
      $emit('review', {
        ...commit,
        ...snapshot,
        hash: commit.hash,
        createdAt: commit.createdAt,
      });
    }

    // Inspector card
    const selectedCommitData = computed(() => {
      const idx = history.selectedCommitIndex.value;
      if (idx < 0) return null;
      return history.filteredCommits.value[idx] || null;
    });

    const wordCount = computed(() => {
      if (history.selectedCommit.value?.content) {
        return history.selectedCommit.value.content
          .replace(/<[^>]*>/g, ' ')
          .split(/\s+/)
          .filter(Boolean).length;
      }
      return selectedCommitData.value?.wordCount || 0;
    });

    const wordDiff = computed(() => {
      const idx = history.selectedCommitIndex.value;
      if (idx < 0) return null;
      const commits = history.filteredCommits.value;
      const current = commits[idx]?.wordCount || 0;
      if (idx >= commits.length - 1) return null;
      const prev = commits[idx + 1]?.wordCount || 0;
      return current - prev;
    });

    const snippet = computed(() => {
      if (history.selectedCommit.value?.content) {
        return history.selectedCommit.value.content.replace(/<[^>]*>/g, '').slice(0, 120);
      }
      return selectedCommitData.value?.snippet || '';
    });

    // Preview editor
    async function togglePreview() {
      showPreview.value = !showPreview.value;
      if (showPreview.value && history.selectedCommit.value?.content) {
        await nextTick();
        const { Editor } = await import('@tiptap/core');
        const { extensions } = await import('@/lib/tiptap');
        destroyPreviewEditor();
        previewEditor = new Editor({
          element: previewEditorEl.value,
          editable: false,
          extensions,
          enableCoreExtensions: { paste: false, textDirection: false },
          content: history.selectedCommit.value.content,
        });
      } else {
        destroyPreviewEditor();
      }
    }

    function destroyPreviewEditor() {
      if (previewEditor) {
        previewEditor.destroy();
        previewEditor = null;
      }
    }

    // Rotary wheel
    const wheelTickCount = computed(() => Math.max(history.filteredCommits.value.length, 20));

    function getTickHeight(i) {
      const commits = history.filteredCommits.value;
      const total = wheelTickCount.value;
      const mappedIdx = Math.round(((i - 1) / (total - 1)) * (commits.length - 1));
      if (commits[mappedIdx]) return total > 20 ? 20 : 28;
      return total > 20 ? 10 : 16;
    }

    function isTickActive(i) {
      const commits = history.filteredCommits.value;
      const total = wheelTickCount.value;
      const mappedIdx = Math.round(((i - 1) / (total - 1)) * (commits.length - 1));
      return mappedIdx === history.selectedCommitIndex.value;
    }

    const activeDateLabel = computed(() => {
      const idx = history.selectedCommitIndex.value;
      if (idx >= 0 && history.filteredCommits.value[idx]) {
        return formatDateTime(history.filteredCommits.value[idx].createdAt);
      }
      if (history.filteredCommits.value.length) {
        return formatDateTime(history.filteredCommits.value[0].createdAt);
      }
      return '';
    });

    function rotateWheel(delta) {
      wheelOffset.value += delta;
    }

    function onDragStart(e) {
      let isDragging = true;
      let dragStartX = e.clientX;
      const onMove = (ev) => {
        if (!isDragging) return;
        rotateWheel((ev.clientX - dragStartX) * 0.5);
        dragStartX = ev.clientX;
      };
      const onUp = () => {
        isDragging = false;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    }

    let touchStartX = 0;
    function onTouchStart(e) {
      touchStartX = e.touches[0].clientX;
    }
    function onTouchMove(e) {
      const delta = e.touches[0].clientX - touchStartX;
      touchStartX = e.touches[0].clientX;
      rotateWheel(delta * 0.5);
    }

    function onWheel(e) {
      rotateWheel(e.deltaX || e.deltaY);
    }

    // Formatting helpers
    function formatDateTime(dateStr) {
      if (!dateStr) return '';
      const d = new Date(dateStr);
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    }

    function relativeTime(dateStr) {
      if (!dateStr) return '';
      const now = Date.now();
      const then = new Date(dateStr).getTime();
      const diff = now - then;
      const mins = Math.floor(diff / 60000);
      if (mins < 1) return tr.value.justNow || 'just now';
      if (mins < 60) return fmt('minutesAgo', { count: mins });
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return fmt('hoursAgo', { count: hrs });
      const days = Math.floor(hrs / 24);
      return fmt('daysAgo', { count: days });
    }

    // Activity log (plan Phase 1): newest first, grouped by day. "Jump to" and
    // "Undo" act on the live editor and are disabled when the anchor no longer
    // resolves or no in-session baseline exists.
    const activityGroups = computed(() => {
      const groups = [];
      let current = null;
      for (const entry of activity.entries.value) {
        const day = new Date(entry.at).toDateString();
        if (!current || current.day !== day) {
          current = { day, label: formatActivityDay(entry.at), items: [] };
          groups.push(current);
        }
        current.items.push(entry);
      }
      return groups;
    });

    function formatActivityDay(at) {
      const d = new Date(at);
      const today = new Date();
      const yesterday = new Date();
      yesterday.setDate(today.getDate() - 1);
      if (d.toDateString() === today.toDateString()) return tr.value.today || 'Today';
      if (d.toDateString() === yesterday.toDateString()) return tr.value.yesterday || 'Yesterday';
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function activityVerb(kind) {
      if (kind === 'insert') return tr.value.activityAdded || 'added';
      if (kind === 'delete') return tr.value.activityDeleted || 'deleted';
      if (kind === 'replace') return tr.value.activityChanged || 'changed';
      return tr.value.activityEdited || 'edited';
    }

    // A snippet is the stable-enough anchor: positions drift after later edits,
    // so a miss disables the action instead of selecting the wrong range.
    function findTextRange(doc, rawNeedle) {
      const needle = String(rawNeedle || '').replace(/\s+/g, ' ').trim();
      if (!doc || !needle) return null;
      let found = null;
      doc.descendants((node, pos) => {
        if (found) return false;
        if (!node.isText || !node.text) return true;
        const idx = node.text.indexOf(needle);
        if (idx >= 0) {
          found = { from: pos + idx, to: pos + idx + needle.length };
          return false;
        }
        return true;
      });
      return found;
    }

    function canJump(entry) {
      return !!findTextRange(
        props.editor?.state?.doc,
        entry?.anchorHint || entry?.summary
      );
    }

    function jumpTo(entry) {
      const range = findTextRange(
        props.editor?.state?.doc,
        entry?.anchorHint || entry?.summary
      );
      if (!range) return false;
      try {
        props.editor.chain().focus().setTextSelection(range).scrollIntoView().run();
        return true;
      } catch {
        return false;
      }
    }

    function undoActivity(entry) {
      activity.undo(entry, props.editor);
    }

    function confirmClearActivity() {
      dialog.confirm({
        title: tr.value.clearActivityTitle || 'Clear activity?',
        body:
          tr.value.clearActivityBody ||
          'This removes the activity log for this note. The note itself is not changed.',
        icon: 'riDeleteBinLine',
        okText: translations.value?.dialog?.confirm || 'Clear',
        cancelText: translations.value?.dialog?.cancel || 'Cancel',
        okVariant: 'danger',
        onConfirm: () => activity.clear(),
      });
    }

    // Lifecycle
    onMounted(() => {
      history.loadCommits(props.workspaceId, props.noteId);
      activity.loadIfNeeded(props.noteId);
    });

    onBeforeUnmount(() => {
      destroyPreviewEditor();
    });

    watch(
      () => history.selectedCommit.value,
      async (val) => {
        if (showPreview.value && val?.content) {
          await nextTick();
          const { Editor } = await import('@tiptap/core');
          const { extensions } = await import('@/lib/tiptap');
          destroyPreviewEditor();
          previewEditor = new Editor({
            element: previewEditorEl.value,
            editable: false,
            extensions,
          enableCoreExtensions: { paste: false, textDirection: false },
            content: val.content,
          });
        }
      }
    );

    const filteredCommits = computed(() => history.filteredCommits.value);

    return {
      history,
      filteredCommits,
      activity,
      activityGroups,
      tab,
      activityVerb,
      canJump,
      jumpTo,
      undoActivity,
      confirmClearActivity,
      showPreview,
      previewEditorEl,
      rotaryContainer,
      wheelOffset,
      dotPosition,
      dateRangeLabel,
      onDotClick,
      reviewCommit,
      selectedCommitData,
      wordCount,
      wordDiff,
      snippet,
      togglePreview,
      wheelTickCount,
      getTickHeight,
      isTickActive,
      activeDateLabel,
      rotateWheel,
      onDragStart,
      onTouchStart,
      onTouchMove,
      onWheel,
      formatDateTime,
      relativeTime,
      tr,
      fmt,
    };
  },
};
</script>
<style>
.slide-up-enter-active,
.slide-up-leave-active {
  transition: transform 300ms var(--ease-standard), opacity 300ms var(--ease-standard);
}
.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(20px);
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .slide-up-enter-active,
  .slide-up-leave-active {
    transition-duration: 0.01ms;
  }
}
</style>
