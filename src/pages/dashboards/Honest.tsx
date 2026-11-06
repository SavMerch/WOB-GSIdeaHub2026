import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip } from "recharts";
import { Lock } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { rpc, unwrap } from "@/lib/api";
import { DASHBOARDS } from "@/lib/dashboards";
import { useAction, useHealthSummary } from "@/hooks/data";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Spinner, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/primitives";
import { PageHeader, SectionHeader, SuppressedNote } from "@/components/collab/common";
import { ContributionBoard } from "@/components/collab/ContributionBoard";

const D = DASHBOARDS[0];

export default function Honest() {
  const [tab, setTab] = React.useState(() => (new URLSearchParams(location.search).get("item") ? "boards" : "doing"));
  return (
    <div>
      <PageHeader dashboard={D} title={D.question} subtitle={D.subtitle} />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="doing">How are we doing?</TabsTrigger>
          <TabsTrigger value="boards">What's working & what needs to be said</TabsTrigger>
        </TabsList>
        <TabsContent value="doing"><HowAreWeDoing /></TabsContent>
        <TabsContent value="boards">
          <div className="grid gap-10 xl:grid-cols-2">
            <section>
              <SectionHeader letter="B" title="What's Working?" prompt="What are we doing well that we shouldn't lose?" />
              <ContributionBoard
                board="honest_working" heading="Add a thought" prompt="What are we doing well that we shouldn't lose?"
                titleLabel="Your thought" titlePlaceholder="e.g. We show up for clients when it counts"
                addLabel="Add a thought" emptyTitle="What's working?" emptyText="Name something we should protect as we grow."
                enableNominate layout="list"
              />
            </section>
            <section>
              <SectionHeader letter="C" title="What Needs to Be Said?" prompt="What's something we need to be more honest about?" />
              <ContributionBoard
                board="honest_unsaid" heading="Add a thought" prompt="What's something we need to be more honest about?"
                titleLabel="Your thought" addLabel="Add a thought" allowAnonymous
                emptyTitle="Nothing on the table yet" emptyText="You can share here anonymously if that makes it easier."
                enableNominate layout="list"
              />
            </section>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function HowAreWeDoing() {
  const { canContribute, profile, settings } = useAuth();
  const qc = useQueryClient();
  const summary = useHealthSummary();
  const mine = useQuery({
    queryKey: ["my-health", profile?.id],
    queryFn: async () =>
      unwrap(await supabase.from("health_ratings").select("category_id, score")) as { category_id: string; score: number }[],
  });
  const [draft, setDraft] = React.useState<Record<string, number>>({});
  React.useEffect(() => {
    if (mine.data) setDraft(Object.fromEntries(mine.data.map((r) => [r.category_id, r.score])));
  }, [mine.data]);
  const save = useAction(
    () => rpc("submit_health_ratings", { p_ratings: Object.entries(draft).map(([category_id, score]) => ({ category_id, score })) }),
    { success: "Your ratings are saved", invalidate: [["my-health"], ["health-summary"]] },
  );
  const threshold = settings?.privacy_threshold ?? 3;
  const rows = summary.data ?? [];
  const shown = rows.filter((r) => !r.suppressed);
  const chartData = shown.map((r) => ({ label: r.label, score: Number(r.avg_score) }));
  const dirty = mine.data && rows.some((r) => (draft[r.category_id] ?? null) !== (mine.data.find((m) => m.category_id === r.category_id)?.score ?? null));

  if (summary.isLoading) return <Spinner />;
  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Your ratings</CardTitle>
          <CardDescription className="flex items-center gap-1.5"><Lock className="size-3.5" aria-hidden /> Only you can see your individual answers. Update them any time.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(undefined, { onSuccess: () => qc.invalidateQueries({ queryKey: ["health-summary"] }) });
            }}
          >
            {rows.map((r) => {
              const v = draft[r.category_id];
              return (
                <div key={r.category_id}>
                  <div className="mb-1 flex items-center justify-between">
                    <label htmlFor={`h-${r.key}`} className="text-sm font-medium">{r.label}</label>
                    <span className="w-14 text-right text-sm tabular-nums text-ink-soft">{v ? `${v} / 10` : "—"}</span>
                  </div>
                  <input
                    id={`h-${r.key}`}
                    type="range" min={1} max={10} step={1}
                    value={v ?? 5}
                    disabled={!canContribute}
                    onChange={(e) => setDraft({ ...draft, [r.category_id]: Number(e.target.value) })}
                    className="w-full accent-[var(--color-d1)]"
                    aria-valuetext={v ? `${v} out of 10` : "Not rated"}
                  />
                  <div className="flex justify-between text-[11px] text-muted"><span>Needs work</span><span>Strong</span></div>
                </div>
              );
            })}
            {canContribute && (
              <Button type="submit" variant="brand" loading={save.isPending} disabled={Object.keys(draft).length === 0 || !dirty}>
                {mine.data?.length ? "Update my ratings" : "Save my ratings"}
              </Button>
            )}
          </form>
        </CardContent>
      </Card>

      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle>How the group sees it</CardTitle>
          <CardDescription>Average ratings across everyone who has responded (1–10).</CardDescription>
        </CardHeader>
        <CardContent>
          {shown.length < 3 ? (
            <SuppressedNote n={Math.max(0, ...rows.map((r) => r.respondents))} threshold={threshold} />
          ) : (
            <>
              <div className="h-80 w-full" role="img" aria-label={`Radar chart of group averages: ${chartData.map((d) => `${d.label} ${d.score}`).join(", ")}`}>
                <ResponsiveContainer>
                  <RadarChart data={chartData} outerRadius="72%">
                    <PolarGrid stroke="var(--color-line)" />
                    <PolarAngleAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--color-ink-soft)" }} />
                    <PolarRadiusAxis domain={[0, 10]} tickCount={6} tick={{ fontSize: 10, fill: "var(--color-muted)" }} axisLine={false} />
                    <Radar dataKey="score" stroke="var(--color-d1)" fill="var(--color-d1)" fillOpacity={0.18} strokeWidth={2} isAnimationActive={false} />
                    <Tooltip formatter={(v) => [`${v} / 10`, "Average"]} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
              <table className="mt-4 w-full text-sm">
                <caption className="sr-only">Group averages by category</caption>
                <thead><tr className="text-left text-xs text-muted"><th className="py-1 font-medium">Category</th><th className="py-1 text-right font-medium">Average</th><th className="py-1 text-right font-medium">Responses</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.category_id} className="border-t border-line">
                      <td className="py-1.5">{r.label}</td>
                      <td className="py-1.5 text-right tabular-nums">{r.suppressed ? <span className="text-muted">Not enough yet</span> : Number(r.avg_score).toFixed(1)}</td>
                      <td className="py-1.5 text-right tabular-nums text-muted">{r.respondents}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
