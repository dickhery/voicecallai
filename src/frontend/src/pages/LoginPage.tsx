import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import {
  CheckCircle2,
  Mic,
  Settings2,
  Shield,
  Wifi,
  WifiOff,
  Zap,
} from "lucide-react";
import { useEffect, useRef } from "react";

const features = [
  {
    icon: Mic,
    title: "xAI Voice API",
    desc: "Powered by Grok — state-of-the-art conversational AI",
  },
  {
    icon: Zap,
    title: "Real Calls",
    desc: "Twilio integration for actual outbound phone calls",
  },
  {
    icon: Settings2,
    title: "Full Control",
    desc: "Configure voice, tone, prompts, and turn detection",
  },
  {
    icon: Shield,
    title: "Secure & Private",
    desc: "Internet Identity authentication, no passwords",
  },
];

/** Animated waveform bars rendered on a canvas */
function WaveformCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const bars = 28;
    let t = 0;

    function draw() {
      if (!canvas || !ctx) return;
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      const barW = 3;
      const gap = (W - bars * barW) / (bars + 1);

      for (let i = 0; i < bars; i++) {
        const x = gap + i * (barW + gap);
        const phase = (i / bars) * Math.PI * 2;
        const amplitude =
          0.35 + 0.55 * Math.abs(Math.sin(phase * 0.7 + t * 0.04));
        const h = amplitude * H * 0.85;
        const y = (H - h) / 2;
        const opacity = 0.4 + 0.6 * amplitude;
        ctx.fillStyle = `oklch(0.72 0.19 195 / ${opacity})`;
        ctx.beginPath();
        ctx.roundRect(x, y, barW, h, 2);
        ctx.fill();
      }
      t++;
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        animRef.current = requestAnimationFrame(draw);
      }
    }

    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={220}
      height={40}
      className="opacity-80"
      role="img"
      aria-label="Audio waveform visualizer"
    />
  );
}

function StatusPill({
  ok,
  label,
}: {
  ok: boolean | undefined;
  label: string;
}) {
  if (ok === undefined) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Skeleton className="w-2 h-2 rounded-full" />
        {label}
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium ${
        ok ? "text-primary" : "text-muted-foreground"
      }`}
    >
      {ok ? (
        <CheckCircle2 className="w-3 h-3" />
      ) : (
        <WifiOff className="w-3 h-3" />
      )}
      {label}
    </span>
  );
}

export default function LoginPage({
  xaiConfigured,
  twilioConfigured,
  configLoading,
}: {
  xaiConfigured?: boolean;
  twilioConfigured?: boolean;
  configLoading?: boolean;
}) {
  const { login, isInitializing, isLoggingIn } = useAuth();
  const isLoading = isInitializing;

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 py-12">
      {/* Ambient background */}
      <div
        className="fixed inset-0 overflow-hidden pointer-events-none"
        aria-hidden="true"
      >
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-primary/4 rounded-full blur-3xl" />
        <div className="absolute top-1/4 left-1/4 w-48 h-48 bg-primary/3 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* Logo + wordmark */}
        <div className="flex flex-col items-center mb-8">
          <div
            className="flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 border border-primary/30 mb-4 shadow-elevated"
            aria-hidden="true"
          >
            <Mic className="w-8 h-8 text-primary" />
          </div>
          <h1 className="font-display text-3xl font-bold text-foreground tracking-tight">
            VoiceCall AI
          </h1>
          <p className="text-muted-foreground mt-1.5 text-center text-sm">
            AI-powered phone conversations, fully configurable.
          </p>

          {/* Waveform animation */}
          <div className="mt-4">
            <WaveformCanvas />
          </div>
        </div>

        {/* App status indicator */}
        <div
          className="flex items-center justify-center gap-5 mb-7 px-4 py-2.5 rounded-xl bg-card/50 border border-border/60"
          data-ocid="login.status_panel"
        >
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground/70">
            <Wifi className="w-3 h-3" />
            <span className="font-medium">System</span>
          </div>
          <div className="w-px h-3 bg-border" />
          {configLoading ? (
            <>
              <StatusPill ok={undefined} label="xAI" />
              <StatusPill ok={undefined} label="Twilio" />
            </>
          ) : (
            <>
              <StatusPill ok={xaiConfigured} label="xAI" />
              <StatusPill ok={twilioConfigured} label="Twilio" />
            </>
          )}
          {!configLoading && !xaiConfigured && !twilioConfigured && (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 border-muted-foreground/30 text-muted-foreground/70"
            >
              Setup required
            </Badge>
          )}
        </div>

        {/* Feature grid */}
        <div className="grid grid-cols-2 gap-3 mb-7">
          {features.map(({ icon: Icon, title, desc }) => (
            <div
              key={title}
              className="p-3.5 rounded-xl bg-card border border-border hover:border-primary/30 transition-smooth"
            >
              <Icon className="w-4 h-4 text-primary mb-2" />
              <p className="text-xs font-semibold text-foreground">{title}</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                {desc}
              </p>
            </div>
          ))}
        </div>

        {/* Login card */}
        <div
          className="bg-card border border-border rounded-2xl p-6 shadow-elevated"
          data-ocid="login.card"
        >
          {isLoading ? (
            <div data-ocid="login.loading_state" className="space-y-3">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-11 w-full rounded-lg mt-2" />
            </div>
          ) : (
            <>
              <h2 className="font-display text-lg font-semibold text-foreground mb-1">
                Sign in to get started
              </h2>
              <p className="text-sm text-muted-foreground mb-5">
                Use Internet Identity — no passwords, no emails required.
              </p>
              <Button
                type="button"
                onClick={login}
                disabled={isLoggingIn}
                data-ocid="login.submit_button"
                className="w-full h-11 font-semibold text-sm"
              >
                {isLoggingIn
                  ? "Opening login…"
                  : "Sign in with Internet Identity"}
              </Button>
              <p className="text-xs text-muted-foreground/60 text-center mt-4 leading-relaxed">
                Buy phone time with Stripe, then call here or connect your AI
                assistant. Use the same Internet Identity for shared phone time.
              </p>
            </>
          )}
        </div>

        <section
          className="mt-6 rounded-2xl border border-border bg-card p-6 space-y-4"
          aria-labelledby="agent-start"
        >
          <h2 id="agent-start" className="font-display text-lg font-semibold">
            Your assistant can make the call
          </h2>
          <p className="text-sm text-muted-foreground">
            Appointment follow-ups, business inquiries, and AI answering. Start
            with prepaid time: $5 / 30 minutes, $10 / 60 minutes, or $20 / 120
            minutes.
          </p>
          <ol className="list-decimal pl-5 space-y-3 text-sm text-muted-foreground">
            <li>
              Sign in and buy phone time with Stripe, or authorize an ICP
              purchase through your assistant.
            </li>
            <li>
              Add the official ICP MCP connector to an MCP-compatible assistant
              and authorize VoiceCall AI through Internet Identity.
            </li>
            <li>
              Tell your assistant who to call and what to say, including a
              fictional name. It queues and tracks the call without a separate
              consent step.
            </li>
          </ol>
          <p className="text-xs text-muted-foreground">Connector URL</p>
          <code className="block select-all break-all rounded-lg bg-muted p-3 text-xs">
            https://mcp.internetcomputer.org/mcp
          </code>
          <div className="flex flex-wrap gap-4 text-sm text-primary">
            <a className="underline underline-offset-4" href="/guide.html">
              Setup, pricing & FAQ
            </a>
            <a className="underline underline-offset-4" href="/llms.txt">
              Agent instructions
            </a>
          </div>
          <p className="text-xs text-muted-foreground">
            Not an emergency service. Threats of violence, false reports,
            swatting, and emergency calls are prohibited. A fictional name is
            allowed.
          </p>
        </section>

        <p className="text-center text-xs text-muted-foreground/40 mt-6">
          © {new Date().getFullYear()}.{" "}
          <a
            href="https://richardhery.com"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-primary transition-colors"
          >
            Built with richardhery.com
          </a>
        </p>
      </div>
    </div>
  );
}
