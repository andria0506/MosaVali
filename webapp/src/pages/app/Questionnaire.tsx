import { PageTitle, Screen } from '../../components/app/kit';
import { CustomNumbersForm, DEFAULT_CUSTOM } from '../../components/app/CustomNumbersForm';
import { useI18n } from '../../i18n';

/** "Enter your own numbers" — creates a synthetic customer, then the normal consent flow. */
export default function Questionnaire() {
  const { t } = useI18n();
  return (
    <Screen>
      <PageTitle title={t('app.own.title')} lead={t('app.own.lead')} />
      <CustomNumbersForm initial={DEFAULT_CUSTOM} />
    </Screen>
  );
}
