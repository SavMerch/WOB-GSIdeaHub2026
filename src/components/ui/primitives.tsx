import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

// ---------------- Card ----------------
export function Card({ className, ...p }: React.ComponentProps<"div">) {
  return <div className={cn("rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]", className)} {...p} />;
}
export function CardHeader({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 p-5 pb-3", className)} {...p} />;
}
export function CardTitle({ className, ...p }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("font-display text-base font-semibold text-ink", className)} {...p} />;
}
export function CardDescription({ className, ...p }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-muted", className)} {...p} />;
}
export function CardContent({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5 pt-0", className)} {...p} />;
}

// ---------------- Form controls ----------------
const field =
  "w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:border-brand disabled:opacity-60";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...p }, ref) => <input ref={ref} className={cn(field, "h-10", className)} {...p} />,
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...p }, ref) => <textarea ref={ref} className={cn(field, "min-h-[88px] py-2 leading-relaxed", className)} {...p} />,
);
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...p }, ref) => <select ref={ref} className={cn(field, "h-10 pr-8", className)} {...p} />,
);
Select.displayName = "Select";

export function Label({ className, ...p }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return <LabelPrimitive.Root className={cn("text-sm font-medium text-ink", className)} {...p} />;
}

export function Field({ label, hint, htmlFor, children, className }: { label: string; hint?: React.ReactNode; htmlFor: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function Switch({ className, ...p }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent bg-line-strong transition-colors data-[state=checked]:bg-brand disabled:opacity-50",
        className,
      )}
      {...p}
    >
      <SwitchPrimitive.Thumb className="block size-5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-5" />
    </SwitchPrimitive.Root>
  );
}

// ---------------- Badge ----------------
export function Badge({ className, tone = "neutral", ...p }: React.HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "brand" | "warn" | "danger" | "success" | "outline" }) {
  const tones = {
    neutral: "bg-canvas text-ink-soft border-line",
    brand: "bg-brand-soft text-brand-dark border-transparent",
    warn: "bg-d2-soft text-warning border-transparent",
    danger: "bg-danger-soft text-danger border-transparent",
    success: "bg-d3-soft text-success border-transparent",
    outline: "bg-transparent text-ink-soft border-line-strong",
  } as const;
  return <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium", tones[tone], className)} {...p} />;
}

// ---------------- Tabs ----------------
export const Tabs = TabsPrimitive.Root;
export function TabsList({ className, ...p }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn("inline-flex max-w-full gap-1 overflow-x-auto rounded-xl border border-line bg-surface p-1", className)} {...p} />;
}
export function TabsTrigger({ className, ...p }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:text-ink data-[state=active]:bg-ink data-[state=active]:text-white",
        className,
      )}
      {...p}
    />
  );
}
export const TabsContent = ({ className, ...p }: React.ComponentProps<typeof TabsPrimitive.Content>) => (
  <TabsPrimitive.Content className={cn("mt-5 focus-visible:outline-none", className)} {...p} />
);

// ---------------- Misc ----------------
export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 py-8 text-sm text-muted">
      <span className="size-4 animate-spin rounded-full border-2 border-line-strong border-t-brand" aria-hidden />
      {label}…
    </div>
  );
}

export function Notice({ tone = "info", children, className }: { tone?: "info" | "warn" | "danger"; children: React.ReactNode; className?: string }) {
  const tones = { info: "border-brand/20 bg-brand-soft text-ink-soft", warn: "border-d2/25 bg-d2-soft text-ink-soft", danger: "border-danger/25 bg-danger-soft text-danger" };
  return <div className={cn("rounded-xl border px-4 py-3 text-sm leading-relaxed", tones[tone], className)}>{children}</div>;
}
