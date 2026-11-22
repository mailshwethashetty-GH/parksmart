import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useInbox, useMarkRead } from '@/lib/me-api';
import { cn } from '@/lib/utils';

const timeFormat = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** In-app inbox (FR-25): every notice lands here, even when email is capped or held. */
export function NotificationBell() {
  const { t } = useTranslation();
  const inbox = useInbox();
  const markRead = useMarkRead();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const wrapper = useRef<HTMLDivElement>(null);
  const unread = inbox.data?.unread ?? 0;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onClick = (e: MouseEvent) => {
      if (!wrapper.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  return (
    <div ref={wrapper} className="relative">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={unread ? t('inbox.labelUnread', { count: unread }) : t('inbox.label')}
        onClick={() => setOpen((o) => !o)}
        className="relative"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </Button>
      {open && (
        <div
          id={panelId}
          role="region"
          aria-label={t('inbox.label')}
          className="absolute right-0 z-20 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-lg border bg-card shadow-lg"
        >
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-semibold">{t('inbox.label')}</span>
            <Button
              variant="ghost"
              size="sm"
              disabled={!unread || markRead.isPending}
              onClick={() => markRead.mutate('all')}
            >
              {t('inbox.markAll')}
            </Button>
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {inbox.data?.items.length ? (
              inbox.data.items.map((n) => (
                <li key={n.id} className="border-b last:border-b-0">
                  <button
                    type="button"
                    className={cn(
                      'flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm hover:bg-secondary',
                      !n.read && 'bg-secondary/50',
                    )}
                    onClick={() => !n.read && markRead.mutate([n.id])}
                  >
                    <span className={cn(!n.read && 'font-semibold')}>
                      {!n.read && <span className="sr-only">{t('inbox.unread')}: </span>}
                      {n.title}
                    </span>
                    {n.body && <span className="text-muted-foreground">{n.body}</span>}
                    <span className="text-xs text-muted-foreground">
                      {timeFormat.format(new Date(n.createdAt))}
                    </span>
                  </button>
                </li>
              ))
            ) : (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                {t('inbox.empty')}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
