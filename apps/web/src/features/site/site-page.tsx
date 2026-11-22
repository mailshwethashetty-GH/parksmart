import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { Alert } from '@/components/ui/alert';
import { useSite } from '@/lib/admin-api';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Approvals } from './approvals';
import { BayBlocks } from './blocks';
import { SettingsForm } from './settings-form';
import { ZonesAndBays } from './zones-bays';

const TABS = ['bays', 'blocks', 'approvals', 'settings'] as const;
type Tab = (typeof TABS)[number];

/** /admin/site (FR-26, FR-13): zones, bays, blocks, approvals, settings. */
export function SitePage() {
  const { t } = useTranslation();
  const site = useSite();
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.includes(params.get('tab') as Tab) ? (params.get('tab') as Tab) : 'bays';

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{t('site.title')}</h1>
        {site.data && <p className="text-sm text-muted-foreground">{site.data.name}</p>}
      </div>
      <div role="tablist" aria-label={t('site.title')} className="flex flex-wrap gap-1 border-b">
        {TABS.map((id) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setParams({ tab: id })}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm',
              tab === id
                ? 'border-primary font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t(`site.tabs.${id}`)}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {site.isError && <Alert tone="error">{errorMessage(site.error)}</Alert>}
        {tab === 'bays' && <ZonesAndBays />}
        {tab === 'blocks' && <BayBlocks />}
        {tab === 'approvals' && <Approvals />}
        {tab === 'settings' && site.data && <SettingsForm key={site.data.id} site={site.data} />}
      </div>
    </div>
  );
}
