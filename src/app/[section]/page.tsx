import { EmployeeEntry } from "@/components/workforce-ui";
import { notFound } from "next/navigation";
import { Schedule } from "@/components/schedule-view";
import { Intelligence } from "@/components/planner";
import {
  Team,
  Availability,
  Labour,
  Requests,
  Settings,
} from "@/components/workspace-views";
export function generateStaticParams() {
  return [
    "schedule",
    "team",
    "availability",
    "labour",
    "requests",
    "settings",
    "intelligence",
    "employee",
    "sign-in",
  ].map((section) => ({ section }));
}
export default async function Page({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  switch (section) {
    case "schedule":
      return <Schedule />;
    case "team":
      return <Team />;
    case "availability":
      return <Availability />;
    case "labour":
      return <Labour />;
    case "requests":
      return <Requests />;
    case "intelligence":
      return <Intelligence />;
    case "sign-in":
      return <EmployeeEntry />;
    case "employee":
      return <EmployeeEntry />;
    case "settings":
      return <Settings />;
    default:
      notFound();
  }
}
