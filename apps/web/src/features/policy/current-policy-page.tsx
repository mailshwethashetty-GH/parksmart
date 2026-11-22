import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useCurrentPolicy } from '@/lib/admin-api';
import { errorMessage } from '@/lib/api';

/** /app/policy (FR-12): the rules in force, in plain language, for every employee. */
export function CurrentPolicyPage() {
  const { t } = useTranslation();
  const policy = useCurrentPolicy();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('policy.howBaysAreShared')}</CardTitle>
      </CardHeader>
      <CardContent>
        {policy.isError && <Alert tone="error">{errorMessage(policy.error)}</Alert>}
        {policy.data && <p className="text-sm whitespace-pre-line">{policy.data.plainLanguage}</p>}
      </CardContent>
    </Card>
  );
}
