import { SYNC_TRANSPORT } from '@/lib/api/types';

export function shouldUseCloudSyncByDefault({ isAuthenticated, isPaidPlan }) {
  return Boolean(isAuthenticated && isPaidPlan);
}

export function getOnboardingSyncTransport({ isAuthenticated, isPaidPlan }) {
  return shouldUseCloudSyncByDefault({ isAuthenticated, isPaidPlan })
    ? SYNC_TRANSPORT.REMOTE
    : SYNC_TRANSPORT.FOLDER;
}
