/** Query/mutation hooks for the admin area (M2). Responses are validated with shared schemas. */
import {
  approvalSchema,
  approvalsResponseSchema,
  bayBlocksResponseSchema,
  baySchema,
  baysResponseSchema,
  currentPolicyResponseSchema,
  feasibilityResponseSchema,
  okResponseSchema,
  policyResponseSchema,
  policyVersionDetailSchema,
  siteResponseSchema,
  usersResponseSchema,
  zoneSchema,
  zonesResponseSchema,
  type BayType,
  type Role,
  type RuleInput,
  type SiteSettings,
  type ZoneKind,
} from '@parksmart/shared';
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { api } from './api';

export const keys = {
  site: ['admin', 'site'] as const,
  zones: ['admin', 'zones'] as const,
  bays: ['admin', 'bays'] as const,
  blocks: ['admin', 'blocks'] as const,
  approvals: ['admin', 'approvals'] as const,
  users: (q: string, role?: Role) => ['admin', 'users', q, role ?? ''] as const,
  policy: ['admin', 'policy'] as const,
  version: (v: number) => ['admin', 'policy', 'version', v] as const,
  currentPolicy: ['policy', 'current'] as const,
};

/** Mutation that refreshes the given queries on success. */
function useAdminMutation<TVars, TResult>(
  fn: (vars: TVars) => Promise<TResult>,
  invalidate: QueryKey[],
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => Promise.all(invalidate.map((queryKey) => qc.invalidateQueries({ queryKey }))),
  });
}

// --- site ------------------------------------------------------------------
export const useSite = () =>
  useQuery({ queryKey: keys.site, queryFn: () => api.get('/admin/site', siteResponseSchema) });

export const useUpdateSettings = () =>
  useAdminMutation(
    (settings: SiteSettings) => api.put('/admin/site/settings', siteResponseSchema, settings),
    [keys.site, keys.policy],
  );

// --- zones and bays ----------------------------------------------------------
export const useZones = () =>
  useQuery({ queryKey: keys.zones, queryFn: () => api.get('/admin/zones', zonesResponseSchema) });

export const useCreateZone = () =>
  useAdminMutation(
    (body: { name: string; kind: ZoneKind; capacity: number | null }) =>
      api.post('/admin/zones', zoneSchema, body),
    [keys.zones],
  );

export const useBays = () =>
  useQuery({ queryKey: keys.bays, queryFn: () => api.get('/admin/bays', baysResponseSchema) });

export const useBulkCreateBays = () =>
  useAdminMutation(
    (body: { zoneId: string; prefix: string; start: number; count: number; bayType: BayType }) =>
      api.post('/admin/bays/bulk', baysResponseSchema, body),
    [keys.bays, keys.zones],
  );

export const useUpdateBay = () =>
  useAdminMutation(
    ({ id, ...body }: { id: string; active?: boolean; bayType?: BayType; hasCharger?: boolean }) =>
      api.patch(`/admin/bays/${id}`, baySchema, body),
    [keys.bays, keys.zones],
  );

// --- bay blocks ------------------------------------------------------------------
export const useBayBlocks = () =>
  useQuery({
    queryKey: keys.blocks,
    queryFn: () => api.get('/admin/bay-blocks', bayBlocksResponseSchema),
  });

export const useCreateBayBlock = () =>
  useAdminMutation(
    (body: {
      bayIds?: string[];
      zoneId?: string;
      dateFrom: string;
      dateTo: string;
      reason: string;
    }) => api.post('/admin/bay-blocks', bayBlocksResponseSchema, body),
    [keys.blocks],
  );

export const useDeleteBayBlock = () =>
  useAdminMutation(
    (id: string) => api.delete(`/admin/bay-blocks/${id}`, okResponseSchema),
    [keys.blocks],
  );

// --- people and approvals ---------------------------------------------------------
export const useUsers = (q: string, role?: Role) =>
  useQuery({
    queryKey: keys.users(q, role),
    queryFn: () => {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (role) params.set('role', role);
      return api.get(`/admin/users?${params}`, usersResponseSchema);
    },
  });

export const useApprovals = () =>
  useQuery({
    queryKey: keys.approvals,
    queryFn: () => api.get('/admin/approvals', approvalsResponseSchema),
  });

export const useCreateApproval = () =>
  useAdminMutation(
    (body: { userId: string; expiresOn: string }) =>
      api.post('/admin/approvals', approvalSchema, body),
    [keys.approvals],
  );

export const useRevokeApproval = () =>
  useAdminMutation(
    (id: string) => api.post(`/admin/approvals/${id}/revoke`, approvalSchema),
    [keys.approvals],
  );

// --- policy ------------------------------------------------------------------------
export const usePolicy = () =>
  useQuery({
    queryKey: keys.policy,
    queryFn: () => api.get('/admin/policy', policyResponseSchema),
  });

export const usePolicyVersion = (version: number | undefined) =>
  useQuery({
    queryKey: keys.version(version ?? 0),
    queryFn: () => api.get(`/admin/policy/versions/${version}`, policyVersionDetailSchema),
    enabled: version !== undefined,
  });

export const useCreateDraft = () =>
  useAdminMutation(
    () => api.post('/admin/policy/versions', policyVersionDetailSchema),
    [keys.policy],
  );

export function useSaveDraftRules(version: number) {
  return useAdminMutation(
    (rules: RuleInput[]) =>
      api.put(`/admin/policy/versions/${version}/rules`, policyVersionDetailSchema, { rules }),
    [keys.version(version)],
  );
}

/** Discards a draft. Drops its cached detail first so nothing refetches a deleted version. */
export function useDiscardDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (version: number) =>
      api.delete(`/admin/policy/versions/${version}`, okResponseSchema),
    onSuccess: async (_ok, version) => {
      qc.removeQueries({ queryKey: keys.version(version), exact: true });
      await qc.invalidateQueries({ queryKey: keys.policy, exact: true });
    },
  });
}

export function usePublishDraft(version: number) {
  return useAdminMutation(
    (reason: string) =>
      api.post(`/admin/policy/versions/${version}/publish`, policyVersionDetailSchema, { reason }),
    [keys.policy, keys.version(version), keys.currentPolicy],
  );
}

/** Feasibility of the rules as currently edited (not yet saved). */
export const useFeasibility = (rules: RuleInput[] | undefined) =>
  useQuery({
    queryKey: ['admin', 'feasibility', rules],
    queryFn: () => api.post('/admin/rules/feasibility', feasibilityResponseSchema, { rules }),
    enabled: rules !== undefined && rules.length > 0,
    placeholderData: (prev) => prev,
  });

// --- employee -----------------------------------------------------------------
export const useCurrentPolicy = () =>
  useQuery({
    queryKey: keys.currentPolicy,
    queryFn: () => api.get('/policy/current', currentPolicyResponseSchema),
  });
