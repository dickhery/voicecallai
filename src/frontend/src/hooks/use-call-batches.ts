import {
  type AgentCallBatch,
  type AgentCallBatchInput,
  type AgentCallBatchPreviewResult,
  type AgentCallBatchResult,
  type AgentCallResult,
  createActor,
} from "@/bindings/backend";
import { useActor, useInternetIdentity } from "@/hooks/use-icp";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function useCallBatches(enabled: boolean) {
  const { actor, isFetching } = useActor(createActor);
  const { identity } = useInternetIdentity();
  const principal = identity?.getPrincipal().toText();
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: ["myCallBatches", principal],
    });
    void queryClient.invalidateQueries({ queryKey: ["myCalls"] });
    void queryClient.invalidateQueries({ queryKey: ["myBillingStatus"] });
  };
  const batches = useQuery<AgentCallBatch[]>({
    queryKey: ["myCallBatches", principal],
    queryFn: async () => (actor ? actor.agentListCallBatches() : []),
    enabled: enabled && !!actor && !isFetching,
    staleTime: 15_000,
    // Dashboard's existing myCalls query supplies final outcomes after dispatch.
    refetchInterval: (query) =>
      enabled &&
      query.state.data?.some(
        (batch) =>
          batch.remainingCount > 0n ||
          batch.jobs.some(
            (job) => job.status === "queued" || job.status === "claimed",
          ),
      )
        ? 15_000
        : false,
  });
  const preview = useMutation<
    AgentCallBatchPreviewResult,
    Error,
    AgentCallBatchInput
  >({
    mutationFn: async (input) => {
      if (!actor) throw new Error("Sign in before reviewing a call list.");
      return actor.agentPreviewCallBatch(input);
    },
  });
  const enqueue = useMutation<AgentCallBatchResult, Error, AgentCallBatchInput>(
    {
      mutationFn: async (input) => {
        if (!actor) throw new Error("Sign in before queuing calls.");
        return actor.agentQueueCallBatch(input);
      },
      onSuccess: refresh,
    },
  );
  const cancel = useMutation<AgentCallBatchResult, Error, string>({
    mutationFn: async (id) => {
      if (!actor) throw new Error("Sign in before canceling a call list.");
      return actor.agentCancelCallBatch(id);
    },
    onSuccess: refresh,
  });
  const endCall = useMutation<AgentCallResult, Error, string>({
    mutationFn: async (id) => {
      if (!actor) throw new Error("Sign in before ending a call.");
      return actor.agentEndCall(id);
    },
    onSuccess: refresh,
  });
  return { batches, preview, enqueue, cancel, endCall };
}
