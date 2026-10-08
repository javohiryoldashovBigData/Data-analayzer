import { useI18n } from "../lib/i18n";
import { Card, PageHead } from "../components/ui";
import ChemLab from "../components/ChemLab";

export default function LabPage() {
  const { t } = useI18n();
  return (
    <>
      <PageHead title={t("nav_lab")} sub={t("lab_page_sub")} />
      <Card><ChemLab /></Card>
    </>
  );
}
