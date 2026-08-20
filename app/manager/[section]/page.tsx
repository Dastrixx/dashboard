import { notFound } from "next/navigation";
import { Dashboard } from "../../dashboard";
import { isManagerSection } from "../../dashboard-routes";

export default async function ManagerSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;

  if (!isManagerSection(section)) {
    notFound();
  }

  return <Dashboard initialRole="manager" initialSection={section} />;
}
