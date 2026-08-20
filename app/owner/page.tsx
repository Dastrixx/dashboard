import { redirect } from "next/navigation";
import { DEFAULT_DASHBOARD_ROUTE } from "../dashboard-routes";

export default function OwnerPage(){
  redirect(DEFAULT_DASHBOARD_ROUTE.owner);
}
