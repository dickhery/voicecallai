import SettingsPage from "@/pages/user/SettingsPage";
import { createFileRoute } from "@tanstack/react-router";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = (createFileRoute as any)("/user/settings")({
  validateSearch: (search: Record<string, unknown>) => ({
    // Dashboard "create preset" CTAs deep-link here with ?newPreset=1
    newPreset:
      search.newPreset === true ||
      search.newPreset === "1" ||
      search.newPreset === "true",
  }),
  component: SettingsPage,
});
