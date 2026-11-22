/** Hooks for the employee's own inbox, profile, consent and data rights (M7). */
import {
  inboxResponseSchema,
  okResponseSchema,
  profileResponseSchema,
  type ConsentPurpose,
  type DistanceBand,
  type VehicleType,
} from '@parksmart/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export const meKeys = {
  inbox: ['me', 'inbox'] as const,
  profile: ['me', 'profile'] as const,
};

export const useInbox = (enabled = true) =>
  useQuery({
    queryKey: meKeys.inbox,
    queryFn: () => api.get('/me/notifications', inboxResponseSchema),
    enabled,
    refetchInterval: 60_000, // SSE pushes most changes; this is the fallback
  });

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[] | 'all') =>
      api.post('/me/notifications/read', okResponseSchema, { ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: meKeys.inbox }),
  });
}

export const useProfile = (enabled = true) =>
  useQuery({
    queryKey: meKeys.profile,
    queryFn: () => api.get('/me/profile', profileResponseSchema),
    enabled,
  });

/** Profile mutations all return the fresh profile, so write it straight to the cache. */
function useProfileMutation<V>(fn: (vars: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: V) => profileResponseSchema.parse(await fn(vars)),
    onSuccess: (data) => qc.setQueryData(meKeys.profile, data),
  });
}

export const useSetDistanceBand = () =>
  useProfileMutation((distanceBand: DistanceBand | null) =>
    api.patch('/me/profile', profileResponseSchema, { distanceBand }),
  );

export const useAddVehicle = () =>
  useProfileMutation((body: { type: VehicleType; isEv: boolean; plate?: string }) =>
    api.post('/me/vehicles', profileResponseSchema, body),
  );

export const useRemoveVehicle = () =>
  useProfileMutation((id: string) => api.delete(`/me/vehicles/${id}`, profileResponseSchema));

export const useSetConsent = () =>
  useProfileMutation((body: { purpose: ConsentPurpose; granted: boolean }) =>
    api.post('/me/consents', profileResponseSchema, body),
  );

export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete('/me', okResponseSchema),
    onSuccess: () => qc.clear(),
  });
}
