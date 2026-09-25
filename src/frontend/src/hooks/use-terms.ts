import { type TermsStatus, createActor } from "@/bindings/backend";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActor } from "./use-icp";

export function useTermsStatus() {
  const { actor, isFetching } = useActor(createActor);
  return useQuery<TermsStatus | null>({
    queryKey: ["termsStatus"],
    queryFn: async () => {
      if (!actor) return null;
      return actor.agentGetTermsStatus();
    },
    enabled: !!actor && !isFetching,
    staleTime: 60_000,
  });
}

export function useAcceptTerms() {
  const { actor } = useActor(createActor);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!actor) throw new Error("Sign in before accepting the terms.");
      return actor.agentAcceptTerms();
    },
    onSuccess: (status) => {
      queryClient.setQueryData(["termsStatus"], status);
    },
  });
}
