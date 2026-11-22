/** Hooks for check-in (M6): employee QR, running late, bay stickers, and the gate view. */
import {
  bayQrResponseSchema,
  checkinResultSchema,
  gateTodayResponseSchema,
  qrResponseSchema,
  runningLateResponseSchema,
} from '@parksmart/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

const gateKey = ['gate', 'today'] as const;

export const useBookingQr = (bookingId: string, enabled: boolean) =>
  useQuery({
    queryKey: ['booking-qr', bookingId],
    queryFn: () => api.get(`/bookings/${bookingId}/qr`, qrResponseSchema),
    enabled,
    staleTime: 10 * 60_000,
  });

export function useRunningLate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (bookingId: string) =>
      api.post(`/bookings/${bookingId}/running-late`, runningLateResponseSchema),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['requests'] }),
  });
}

export function useBayCheckin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => api.post('/checkins/bay', checkinResultSchema, { token }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['requests'] }),
  });
}

export const useGateToday = () =>
  useQuery({
    queryKey: gateKey,
    queryFn: () => api.get('/gate/today', gateTodayResponseSchema),
    refetchInterval: 30_000,
  });

export function useScanCheckin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => api.post('/checkins/scan', checkinResultSchema, { token }),
    onSettled: () => qc.invalidateQueries({ queryKey: gateKey }),
  });
}

export function useManualCheckin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (bookingId: string) =>
      api.post('/checkins/manual', checkinResultSchema, { bookingId }),
    onSettled: () => qc.invalidateQueries({ queryKey: gateKey }),
  });
}

export const useBayQr = (bayId: string) =>
  useQuery({
    queryKey: ['bay-qr', bayId],
    queryFn: () => api.get(`/admin/bays/${bayId}/qr`, bayQrResponseSchema),
  });

/** What a bay sticker encodes: a link that opens the check-in screen on the employee's phone. */
export const bayCheckinUrl = (token: string) =>
  `${window.location.origin}/app/checkin?bay=${encodeURIComponent(token)}`;
