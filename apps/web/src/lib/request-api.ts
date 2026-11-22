/** Query/mutation hooks for employee requests and recurring patterns (M3). */
import {
  calendarResponseSchema,
  recurringPatternSchema,
  recurringPatternsResponseSchema,
  requestSchema,
  requestsResponseSchema,
  type ArrivalWindow,
  type BayType,
  type ReasonCategory,
} from '@parksmart/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

const keys = {
  all: ['requests'] as const,
  calendar: ['requests', 'calendar'] as const,
  list: ['requests', 'list'] as const,
  patterns: ['requests', 'patterns'] as const,
};

/** Every request mutation can change the calendar, the list and pattern previews. */
function useRequestMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.all }),
  });
}

export const useCalendar = () =>
  useQuery({
    queryKey: keys.calendar,
    queryFn: () => api.get('/requests/calendar?days=28', calendarResponseSchema),
    refetchInterval: 60_000, // the deciding round moves on as rounds run
  });

export const useRequests = () =>
  useQuery({ queryKey: keys.list, queryFn: () => api.get('/requests', requestsResponseSchema) });

export type RequestDraft = {
  dates: string[];
  bayType: BayType;
  arrivalWindow: ArrivalWindow;
  reasonCategory: ReasonCategory | null;
  allowFallback: boolean;
};

export const useCreateRequests = () =>
  useRequestMutation((body: RequestDraft) => api.post('/requests', requestsResponseSchema, body));

export const useWithdrawRequest = () =>
  useRequestMutation((id: string) => api.delete(`/requests/${id}`, requestSchema));

export const usePatterns = () =>
  useQuery({
    queryKey: keys.patterns,
    queryFn: () => api.get('/recurring-patterns', recurringPatternsResponseSchema),
  });

export type PatternDraft = {
  weekdays: number[];
  bayType: BayType;
  arrivalWindow: ArrivalWindow;
  allowFallback: boolean;
};

export const useCreatePattern = () =>
  useRequestMutation((body: PatternDraft) =>
    api.post('/recurring-patterns', recurringPatternSchema, body),
  );

export const useUpdatePattern = () =>
  useRequestMutation(({ id, ...body }: Partial<PatternDraft> & { id: string; active?: boolean }) =>
    api.patch(`/recurring-patterns/${id}`, recurringPatternSchema, body),
  );

export const useToggleSkip = () =>
  useRequestMutation(({ id, date, skipped }: { id: string; date: string; skipped: boolean }) =>
    skipped
      ? api.delete(`/recurring-patterns/${id}/skips/${date}`, recurringPatternSchema)
      : api.post(`/recurring-patterns/${id}/skips`, recurringPatternSchema, { date }),
  );
