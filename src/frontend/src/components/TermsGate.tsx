import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useAcceptTerms, useTermsStatus } from "@/hooks/use-terms";
import { useState } from "react";

export function TermsGate({ children }: { children: React.ReactNode }) {
  const status = useTermsStatus();
  const accept = useAcceptTerms();
  const [agreed, setAgreed] = useState(false);
  if (!status.data) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="space-y-3 w-64">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-4 w-3/4" />
          {status.isError ? (
            <p className="text-sm text-destructive">
              {status.error instanceof Error
                ? status.error.message
                : "Unable to load the terms."}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  if (status.data.current) return <>{children}</>;

  const text = status.data.text;

  return (
    <div className="min-h-screen bg-background text-foreground px-4 py-10">
      <main className="mx-auto w-full max-w-2xl rounded-lg border border-border bg-card p-6 shadow-subtle">
        <h1 className="font-display text-2xl font-bold tracking-tight">
          Terms for VoiceCall AI
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Accept these once. You will be asked again after six months, or sooner
          if the terms change.
        </p>
        <pre className="mt-5 max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-background p-4 font-sans text-sm leading-relaxed text-foreground">
          {text || "The terms could not be loaded. Refresh and try again."}
        </pre>
        {status.isError ? (
          <p className="mt-3 text-sm text-destructive">
            {status.error instanceof Error
              ? status.error.message
              : "Unable to load the terms."}
          </p>
        ) : null}
        <div className="mt-4 flex items-start gap-2">
          <Checkbox
            id="terms-agreement"
            checked={agreed}
            onCheckedChange={(checked) => setAgreed(checked === true)}
          />
          <Label htmlFor="terms-agreement" className="text-sm leading-relaxed">
            I have read these terms. I understand that recording rules differ by
            location, and that I am responsible for following the law that
            applies to my calls.
          </Label>
        </div>
        {accept.isError ? (
          <p className="mt-3 text-sm text-destructive">
            {accept.error instanceof Error
              ? accept.error.message
              : "Unable to save your acceptance."}
          </p>
        ) : null}
        <Button
          type="button"
          className="mt-5"
          disabled={!agreed || !text || accept.isPending}
          onClick={() => accept.mutate()}
        >
          {accept.isPending ? "Saving…" : "Accept and continue"}
        </Button>
      </main>
    </div>
  );
}
