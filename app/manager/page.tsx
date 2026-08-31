import { redirect } from "next/navigation";
import { DEFAULT_DASHBOARD_ROUTE } from "../dashboard-routes";

export default function ManagerPage(){
  redirect(DEFAULT_DASHBOARD_ROUTE.manager);
}
