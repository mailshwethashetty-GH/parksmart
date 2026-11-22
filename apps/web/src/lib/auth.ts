import { devUsersResponseSchema, meResponseSchema } from '@parksmart/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api, ApiError } from './api';

export const meQueryKey = ['me'] as const;

/** The signed-in user, or null when signed out. */
export function useMe() {
  return useQuery({
    queryKey: meQueryKey,
    queryFn: async () => {
      try {
        return await api.get('/me', meResponseSchema);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
  });
}

/** Seeded users for the dev-only login. Fails (404) when the server has dev login off. */
export function useDevUsers(enabled: boolean) {
  return useQuery({
    queryKey: ['dev-users'],
    queryFn: () => api.get('/auth/dev/users', devUsersResponseSchema),
    enabled,
    retry: false,
  });
}

export function useDevSignIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (email: string) => api.post('/auth/dev/sign-in', z.unknown(), { email }),
    onSuccess: () => qc.invalidateQueries({ queryKey: meQueryKey }),
  });
}

/** Starts SSO with the identity provider registered for the email's domain. */
export function useSsoSignIn() {
  return useMutation({
    mutationFn: (email: string) =>
      api.post('/auth/sign-in/sso', z.object({ url: z.string() }), {
        email,
        callbackURL: '/',
      }),
    onSuccess: ({ url }) => window.location.assign(url),
  });
}

export function useSignOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/auth/sign-out', z.unknown()),
    onSuccess: () => qc.setQueryData(meQueryKey, null),
  });
}
