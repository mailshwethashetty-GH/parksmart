import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const tones = {
  info: 'border-border bg-secondary/50',
  warning: 'border-amber-500/40 bg-amber-500/10',
  error: 'border-destructive/40 bg-destructive/10 text-destructive',
  success: 'border-emerald-600/40 bg-emerald-600/10',
};

export function Alert({
  tone = 'info',
  className,
  ...props
}: ComponentProps<'div'> & { tone?: keyof typeof tones }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('rounded-md border px-3 py-2 text-sm', tones[tone], className)}
      {...props}
    />
  );
}
