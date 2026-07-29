import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  useGetAgentAccountIdentity,
  useGetAgentAccountStatus,
  useGetAgentPricing,
  useRefreshAgentIcpPricing,
} from "@/hooks/use-backend";
import { copyTextToClipboard } from "@/lib/clipboard";
import {
  BookOpen,
  Bot,
  CheckCircle2,
  Copy,
  ExternalLink,
  RefreshCw,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

const ICP_MCP_URL = "https://mcp.internetcomputer.org/mcp";
const II_SETTINGS_URL = "https://id.ai/manage/settings";
const AGENT_GUIDE_URL = "https://voicecallai.online/llms.txt";
const AGENT_READY_PROMPT = `Open ${AGENT_GUIDE_URL} first. Use the official Internet Computer MCP (Agent Identity) connector to resolve VoiceCall AI and follow the backend agent API instructions. If you initially find only the frontend asset canister, continue with the backend canister declared in the guide; do not conclude phone calling is unavailable. Call getAgentGuide, authenticate with Internet Identity for voicecallai.online, and confirm the recipient, purpose, preset, recording/transcript choices, and consent with me before calling agentQueueCall.`;
const E8S_PER_ICP = 100_000_000n;

function formatIcp(e8s: bigint): string {
  const whole = e8s / E8S_PER_ICP;
  const fraction = (e8s % E8S_PER_ICP)
    .toString()
    .padStart(8, "0")
    .replace(/0+$/, "")
    .slice(0, 5);
  return `${whole}${fraction ? `.${fraction}` : ""} ICP`;
}

function bytesToHex(bytes?: Uint8Array): string {
  if (!bytes) return "";
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function copyValue(value: string, label: string) {
  try {
    if (!(await copyTextToClipboard(value))) {
      throw new Error("Copy was rejected");
    }
    toast.success(`${label} copied`);
  } catch {
    toast.error(`Unable to copy ${label.toLowerCase()}`);
  }
}

export function AgentAccessCard() {
  const accountQuery = useGetAgentAccountIdentity();
  const pricingQuery = useGetAgentPricing();
  const statusMutation = useGetAgentAccountStatus();
  const refreshPricing = useRefreshAgentIcpPricing();

  const account = accountQuery.data;
  const pricing = pricingQuery.data;
  const statusResult = statusMutation.data;
  const status = statusResult?.__kind__ === "ok" ? statusResult.ok : undefined;
  const subaccountHex = bytesToHex(account?.depositAccount.subaccount);
  const icrcAccount = account
    ? `owner=${account.depositAccount.owner.toText()}; subaccount=0x${subaccountHex}`
    : "";

  const handleCheckBalance = async () => {
    try {
      const result = await statusMutation.mutateAsync();
      if (result.__kind__ === "err") {
        toast.error(result.err);
        return;
      }
      toast.success("Agent account balances updated");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to check balances",
      );
    }
  };

  const handleRefreshPricing = async () => {
    try {
      const result = await refreshPricing.mutateAsync();
      if (result.__kind__ === "err") {
        toast.error(result.err);
        return;
      }
      toast.success(
        result.ok.isFresh
          ? "ICP pricing is current"
          : "Pricing refresh completed",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to refresh pricing",
      );
    }
  };

  return (
    <Card
      className="bg-card border-primary/25 overflow-hidden"
      data-ocid="settings.agent_access.card"
    >
      <CardHeader className="pb-4 bg-primary/[0.04]">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
            <Bot className="w-4.5 h-4.5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-base">
              Use VoiceCall AI from AI chat
            </CardTitle>
            <CardDescription className="mt-1">
              Connect ChatGPT, Claude, or another MCP client to manage presets,
              fund phone time with ICP, place calls, and retrieve call results.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5 pt-5">
        <ol className="grid gap-3 sm:grid-cols-3">
          {[
            {
              title: "Enable AI access",
              body: "In Internet Identity, enable AI access and trust the official connector.",
            },
            {
              title: "Add the connector",
              body: "Paste the MCP URL into your AI app and authorize Actions and questions.",
            },
            {
              title: "Ask naturally",
              body: "Try: “Check my VoiceCall AI balance and show my call presets.”",
            },
          ].map((step, index) => (
            <li
              key={step.title}
              className="rounded-lg border border-border bg-muted/15 p-3"
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span className="w-5 h-5 rounded-full bg-primary/15 text-primary text-[11px] font-bold flex items-center justify-center">
                  {index + 1}
                </span>
                <p className="text-xs font-semibold text-foreground">
                  {step.title}
                </p>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {step.body}
              </p>
            </li>
          ))}
        </ol>

        <div className="flex flex-wrap gap-2">
          <Button
            asChild
            size="sm"
            variant="outline"
            className="gap-2"
            data-ocid="settings.agent_access.identity_link"
          >
            <a href={II_SETTINGS_URL} target="_blank" rel="noreferrer">
              Internet Identity settings
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-2"
            onClick={() => copyValue(ICP_MCP_URL, "MCP connector URL")}
            data-ocid="settings.agent_access.copy_mcp_button"
          >
            <Copy className="w-3.5 h-3.5" />
            Copy MCP URL
          </Button>
          <Button
            asChild
            size="sm"
            variant="outline"
            className="gap-2"
            data-ocid="settings.agent_access.guide_link"
          >
            <a href={AGENT_GUIDE_URL} target="_blank" rel="noreferrer">
              Agent guide
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </Button>
        </div>

        <div className="rounded-lg border border-primary/20 bg-primary/[0.035] p-4 space-y-3">
          <div className="flex items-start gap-2">
            <BookOpen className="w-4 h-4 text-primary mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-semibold">Agent-ready request</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Start a new AI chat with this prompt so it discovers the backend
                calling tools instead of stopping at the web frontend.
              </p>
            </div>
          </div>
          <div className="rounded-md bg-background/70 border border-border px-3 py-2.5">
            <p className="text-[11px] leading-relaxed text-foreground">
              {AGENT_READY_PROMPT}
            </p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            className="h-8 gap-2"
            onClick={() => copyValue(AGENT_READY_PROMPT, "Agent-ready request")}
            data-ocid="settings.agent_access.copy_prompt_button"
          >
            <Copy className="w-3.5 h-3.5" />
            Copy request
          </Button>
        </div>

        <div className="rounded-lg border border-border p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Wallet className="w-4 h-4 text-primary" />
              <div>
                <p className="text-xs font-semibold">Agent ICP account</p>
                <p className="text-[11px] text-muted-foreground">
                  Isolated to your authenticated app principal
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="secondary"
              className="h-8 gap-2"
              onClick={handleCheckBalance}
              disabled={statusMutation.isPending}
              data-ocid="settings.agent_access.check_balance_button"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${statusMutation.isPending ? "animate-spin" : ""}`}
              />
              Check balances
            </Button>
          </div>

          {status && (
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md bg-muted/30 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  ICP available
                </p>
                <p className="text-sm font-semibold mt-0.5">
                  {formatIcp(status.icpBalanceE8s)}
                </p>
              </div>
              <div className="rounded-md bg-muted/30 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Phone time
                </p>
                <p className="text-sm font-semibold mt-0.5">
                  {Math.floor(Number(status.billing.availableSeconds) / 60)} min
                </p>
              </div>
            </div>
          )}

          {account && (
            <div className="space-y-2">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                  ICRC-1 deposit account
                </p>
                <div className="flex items-center gap-2">
                  <code
                    className="text-[10px] font-mono bg-muted/30 rounded px-2 py-1.5 truncate flex-1"
                    title={icrcAccount}
                  >
                    {icrcAccount}
                  </code>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="w-8 h-8 shrink-0"
                    onClick={() => copyValue(icrcAccount, "ICRC-1 account")}
                    aria-label="Copy ICRC-1 account"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                  Legacy ICP account ID
                </p>
                <div className="flex items-center gap-2">
                  <code
                    className="text-[10px] font-mono bg-muted/30 rounded px-2 py-1.5 truncate flex-1"
                    title={account.legacyAccountIdHex}
                  >
                    {account.legacyAccountIdHex}
                  </code>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="w-8 h-8 shrink-0"
                    onClick={() =>
                      copyValue(
                        account.legacyAccountIdHex,
                        "Legacy ICP account ID",
                      )
                    }
                    aria-label="Copy legacy ICP account ID"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div>
              <p className="text-xs font-semibold">ICP phone-time pricing</p>
              <p className="text-[11px] text-muted-foreground">
                Matches the web app’s dollar packages using a cached ICP/USD
                quote.
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 gap-2"
              onClick={handleRefreshPricing}
              disabled={refreshPricing.isPending}
              data-ocid="settings.agent_access.refresh_pricing_button"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${refreshPricing.isPending ? "animate-spin" : ""}`}
              />
              Refresh quote
            </Button>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            {(pricing?.packages ?? []).map((phonePackage) => (
              <div
                key={phonePackage.id}
                className="rounded-md bg-muted/30 px-3 py-2"
              >
                <p className="text-xs font-semibold">
                  {Math.floor(Number(phonePackage.seconds) / 60)} minutes
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {formatIcp(phonePackage.priceE8s)}
                </p>
              </div>
            ))}
          </div>

          {pricing && (
            <div className="flex items-center gap-1.5 mt-3 text-[10px] text-muted-foreground">
              <CheckCircle2
                className={`w-3 h-3 ${pricing.isFresh ? "text-emerald-500" : "text-amber-500"}`}
              />
              {pricing.isFresh
                ? "Quote is current and cached for cycle efficiency."
                : "Quote is stale; refresh it before an ICP purchase."}
            </div>
          )}
        </div>

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          AI sessions authorized to the same Internet Identity app principal
          share this account, presets, phone-time balance, and call history.
          Stripe remains available to people using the web app.
        </p>
      </CardContent>
    </Card>
  );
}
