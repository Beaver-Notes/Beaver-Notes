import { SYNC_TRANSPORT } from '@/lib/api/types';

export function shouldUseCloudSyncByDefault({ isAuthenticated, isPaidPlan }) {
  return Boolean(isAuthenticated && isPaidPlan);
}

export function getOnboardingSyncTransport({ isAuthenticated, isPaidPlan }) {
  return shouldUseCloudSyncByDefault({ isAuthenticated, isPaidPlan })
    ? SYNC_TRANSPORT.REMOTE
    : SYNC_TRANSPORT.FOLDER;
}

// Plain-language destination for the onboarding wizard, derived from the same
// transport policy so the message can never drift from what actually happens.
export function getOnboardingSyncLocation({ isAuthenticated, isPaidPlan }) {
  return getOnboardingSyncTransport({ isAuthenticated, isPaidPlan }) === SYNC_TRANSPORT.REMOTE
    ? 'cloud'
    : 'local';
}
