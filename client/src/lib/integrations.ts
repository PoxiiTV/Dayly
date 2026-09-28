import { useQuery } from "@tanstack/react-query";
import { http } from "@/lib/api";

/**
 * Integrations an admin may keep hidden or announce as "Próximamente" while
 * they are not ready. Unknown (still loading) counts as not shown, so users
 * never glimpse a hidden feature.
 */
export type IntegrationKey = "telegram" | "whatsapp" | "gmailGoogle";
export type IntegrationState = "AVAILABLE" | "COMING_SOON" | "HIDDEN";

export const COMING_SOON_LABEL = "Próximamente";

export function useIntegrations(): Partial<Record<IntegrationKey, IntegrationState>> {
  const { data } = useQuery({
    queryKey: ["integration-visibility"],
    queryFn: () => http.get<{ integrations: Record<IntegrationKey, IntegrationState> }>("/api/integrations"),
    staleTime: 60_000,
  });
  return data?.integrations ?? {};
}

export function useIntegration(key: IntegrationKey): IntegrationState | undefined {
  return useIntegrations()[key];
}

export function integrationShown(state: IntegrationState | undefined): state is "AVAILABLE" | "COMING_SOON" {
  return state === "AVAILABLE" || state === "COMING_SOON";
}
