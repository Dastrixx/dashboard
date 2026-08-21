import { Dashboard } from "../../dashboard";
import { requireDashboardUser } from "../../server-auth";

export default async function OwnerOverviewPage() {
  const user = await requireDashboardUser("owner");
  return (
    <Dashboard
      initialRole="owner"
      initialSection="overview"
      initialUser={user}
    />
  );
}
