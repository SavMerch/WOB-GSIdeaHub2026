import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DASHBOARDS } from "@/lib/dashboards";
import { useCategories, useContributions } from "@/hooks/data";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { PageHeader } from "@/components/collab/common";
import { ContributionBoard } from "@/components/collab/ContributionBoard";
import { Link } from "react-router";

const D = DASHBOARDS[1];

export default function InOurWay() {
  return (
    <div>
      <PageHeader dashboard={D} title={D.question} subtitle={D.subtitle} />
      <Overview />
      <ContributionBoard
        board="barriers" heading="Add an issue" prompt="What's making this harder than it needs to be?"
        titleLabel="What's the issue?" titlePlaceholder="e.g. Approvals take too long" bodyLabel="Explain the problem"
        categoryLabel="Category" categoryRequired
        detailFields={[{ key: "context", label: "Any context that helps? (optional)" }]}
        allowAnonymous addLabel="Add an issue" emptyTitle="No issues raised yet"
        emptyText="Name what's slowing us down. Others can say it resonates, suggest solutions, and connect it to ideas."
        enableTop enableSolutions enableNominate enableFilters
      />
    </div>
  );
}

function Overview() {
  const { data } = useContributions("barriers");
  const { data: cats } = useCategories("barriers");
  const live = (data ?? []).filter((c) => !c.archived && !c.hidden);
  if (live.length === 0) return null;
  const byCat = (cats ?? []).map((c) => ({ name: c.label, issues: live.filter((i) => i.category_id === c.id).length }))
    .filter((x) => x.issues > 0);
  const top = [...live].sort((a, b) => b.resonates_count + b.top_count - (a.resonates_count + a.top_count)).slice(0, 5)
    .filter((c) => c.resonates_count + c.top_count > 0);
  return (
    <div className="mb-8 grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Where issues are clustering</CardTitle><CardDescription>Number of issues raised in each area.</CardDescription></CardHeader>
        <CardContent>
          <div className="h-56" role="img" aria-label={byCat.map((b) => `${b.name}: ${b.issues}`).join(", ")}>
            <ResponsiveContainer>
              <BarChart data={byCat} layout="vertical" margin={{ left: 8, right: 16 }}>
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: "var(--color-muted)" }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={170} tick={{ fontSize: 12, fill: "var(--color-ink-soft)" }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: "var(--color-canvas)" }} />
                <Bar dataKey="issues" fill="var(--color-d2)" radius={[0, 6, 6, 0]} barSize={16} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Getting the most support</CardTitle><CardDescription>Where people are saying "this resonates" or marking it significant.</CardDescription></CardHeader>
        <CardContent>
          {top.length === 0 ? <p className="text-sm text-muted">No reactions yet.</p> : (
            <ol className="flex flex-col gap-2.5">
              {top.map((c, i) => (
                <li key={c.id} className="flex items-center gap-3 text-sm">
                  <span className="w-4 text-right text-xs text-muted">{i + 1}</span>
                  <Link to={`/in-our-way?item=${c.id}`} className="flex-1 hover:underline">{c.title}</Link>
                  <span className="text-xs text-muted">{c.resonates_count} resonate{c.top_count ? ` · ${c.top_count} significant` : ""}</span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
