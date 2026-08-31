import { notFound } from "next/navigation";
import { Dashboard } from "../../dashboard";
import { isManagerSection } from "../../dashboard-routes";
import { requireDashboardUser } from "../../server-auth";

export default async function ManagerSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;

  if (!isManagerSection(section)) {
    notFound();
  }

  const user = await requireDashboardUser("manager");
  return (
    <Dashboard
      initialRole="manager"
      initialSection={section}
      initialUser={user}
    />
  );
}
