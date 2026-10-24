import SchedulePage from "@/pages/user/SchedulePage";
import { createFileRoute } from "@tanstack/react-router";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = (createFileRoute as any)("/user/schedule")({
  component: SchedulePage,
});
