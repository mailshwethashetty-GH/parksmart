import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function Table({ className, ...props }: ComponentProps<'table'>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn('w-full text-sm', className)} {...props} />
    </div>
  );
}
export const Th = ({ className, ...props }: ComponentProps<'th'>) => (
  <th
    className={cn('border-b px-3 py-2 text-left font-medium text-muted-foreground', className)}
    {...props}
  />
);
export const Td = ({ className, ...props }: ComponentProps<'td'>) => (
  <td className={cn('border-b px-3 py-2 align-middle', className)} {...props} />
);
