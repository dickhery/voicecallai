import { createActor as createBackendActor } from "@/bindings/backend";
import { AuthClient } from "@icp-sdk/auth/client";
import type { HttpAgentOptions, Identity } from "@icp-sdk/core/agent";
import { safeGetCanisterEnv } from "@icp-sdk/core/agent/canister-env";
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

type LoginStatus = "idle" | "logging-in" | "success" | "error";

interface RuntimeEnv {
  ii_derivation_origin?: string;
}

interface InternetIdentityContextValue {
  identity: Identity | null;
  isAuthenticated: boolean;
  isInitializing: boolean;
  isLoggingIn: boolean;
  loginStatus: LoginStatus;
  login: () => Promise<void>;
  clear: () => Promise<void>;
}

type ActorFactory<T> = (
  canisterId: string,
  options?: { agentOptions?: HttpAgentOptions },
) => T;

interface CanisterEnv {
  readonly "PUBLIC_CANISTER_ID:backend": string;
}

const InternetIdentityContext =
  createContext<InternetIdentityContextValue | null>(null);

const II_URL = "https://id.ai/authorize";
const EIGHT_HOURS_NS = 8n * 3_600_000_000_000n;

async function loadRuntimeEnv(): Promise<RuntimeEnv> {
  const response = await fetch("/env.json", { cache: "no-store" });
  return response.ok ? response.json() : {};
}

function getCanisterConnection() {
  const canisterEnv = safeGetCanisterEnv<CanisterEnv>();
  const canisterId = canisterEnv?.["PUBLIC_CANISTER_ID:backend"];
  if (!canisterEnv || !canisterId) {
    throw new Error(
      "The backend canister ID is unavailable. Open the app through its IC asset canister, or start Vite after deploying the local backend.",
    );
  }
  return {
    canisterId,
    agentOptions: {
      host: window.location.origin,
      rootKey: canisterEnv.IC_ROOT_KEY,
    } satisfies HttpAgentOptions,
  };
}

async function registerIdentity(identity: Identity): Promise<void> {
  const { canisterId, agentOptions } = getCanisterConnection();
  const actor = createBackendActor(canisterId, {
    agentOptions: { ...agentOptions, identity },
  });
  await actor._initializeAccessControl();
  await actor.agentInitialize("Web app");
}

export function InternetIdentityProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [authClient, setAuthClient] = useState<AuthClient | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginStatus, setLoginStatus] = useState<LoginStatus>("idle");

  useEffect(() => {
    let canceled = false;

    async function initialize() {
      try {
        const runtimeEnv = await loadRuntimeEnv();
        const client = new AuthClient({
          identityProvider: II_URL,
          ...(runtimeEnv.ii_derivation_origin
            ? { derivationOrigin: runtimeEnv.ii_derivation_origin }
            : {}),
        });
        if (canceled) return;
        setAuthClient(client);

        if (client.isAuthenticated()) {
          const restoredIdentity = await client.getIdentity();
          await registerIdentity(restoredIdentity);
          if (!canceled) {
            setIdentity(restoredIdentity);
            setLoginStatus("success");
          }
        }
      } catch (error) {
        console.error("Unable to initialize Internet Identity", error);
        if (!canceled) setLoginStatus("error");
      } finally {
        if (!canceled) setIsInitializing(false);
      }
    }

    void initialize();
    return () => {
      canceled = true;
    };
  }, []);

  const login = useCallback(async () => {
    if (!authClient || isLoggingIn) return;
    setIsLoggingIn(true);
    setLoginStatus("logging-in");
    try {
      const nextIdentity = await authClient.signIn({
        maxTimeToLive: EIGHT_HOURS_NS,
      });
      await registerIdentity(nextIdentity);
      setIdentity(nextIdentity);
      setLoginStatus("success");
    } catch (error) {
      console.error("Internet Identity sign-in failed", error);
      setLoginStatus("error");
      throw error;
    } finally {
      setIsLoggingIn(false);
    }
  }, [authClient, isLoggingIn]);

  const clear = useCallback(async () => {
    if (authClient) await authClient.signOut();
    setIdentity(null);
    setLoginStatus("idle");
  }, [authClient]);

  const value = useMemo<InternetIdentityContextValue>(
    () => ({
      identity,
      isAuthenticated: identity !== null,
      isInitializing,
      isLoggingIn,
      loginStatus,
      login,
      clear,
    }),
    [identity, isInitializing, isLoggingIn, loginStatus, login, clear],
  );

  return (
    <InternetIdentityContext.Provider value={value}>
      {children}
    </InternetIdentityContext.Provider>
  );
}

export function useInternetIdentity(): InternetIdentityContextValue {
  const value = useContext(InternetIdentityContext);
  if (!value) {
    throw new Error(
      "useInternetIdentity must be used inside InternetIdentityProvider.",
    );
  }
  return value;
}

export function useActor<T>(factory: ActorFactory<T>): {
  actor: T | null;
  isFetching: boolean;
  error: Error | null;
} {
  const { identity, isInitializing } = useInternetIdentity();

  return useMemo(() => {
    if (isInitializing || !identity) {
      return { actor: null, isFetching: isInitializing, error: null };
    }
    try {
      const { canisterId, agentOptions } = getCanisterConnection();
      return {
        actor: factory(canisterId, {
          agentOptions: { ...agentOptions, identity },
        }),
        isFetching: false,
        error: null,
      };
    } catch (error) {
      return {
        actor: null,
        isFetching: false,
        error:
          error instanceof Error ? error : new Error("Unable to create actor."),
      };
    }
  }, [factory, identity, isInitializing]);
}
