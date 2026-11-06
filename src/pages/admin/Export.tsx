import { Download } from "lucide-react";
import { toast } from "sonner";
import { rpc } from "@/lib/api";
import { download, toCsv } from "@/lib/csv";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Notice } from "@/components/ui/primitives";

const KINDS = [
  { kind: "contributions", title: "Contributions", desc: "Every idea, issue and thought. Anonymous posts are labeled “Anonymous” — no identity is stored to export." },
  { kind: "comments", title: "Comments", desc: "All discussion threads, with author usernames." },
  { kind: "aggregates", title: "Aggregate results", desc: "Health ratings and priority rankings by unit and by segment — the same thresholded summaries shown in the app. No individual answers." },
  { kind: "roadmap", title: "Roadmap actions", desc: "60/90/120-day actions with status, owner and volunteers." },
  { kind: "bd", title: "2027 Business Development", desc: "Every client, association and conference across units, with sponsor/owner, dollars, dates and the who/what/why details." },
  { kind: "participation", title: "Participation statistics", desc: "Per-person business units and counts of named contributions, comments, volunteering and BD items owned." },
];

async function run(kind: string, fmt: "csv" | "json") {
  try {
    const data = await rpc<unknown>("admin_export", { p_kind: kind });
    const stamp = new Date().toISOString().slice(0, 10);
    if (fmt === "json") return download(`${kind}-${stamp}.json`, JSON.stringify(data, null, 2), "application/json");
    if (kind === "aggregates") {
      // Thresholded per-unit and per-segment results only.
      const d = data as { health: Record<string, unknown>[]; priorities: Record<string, unknown>[] };
      download(`health-aggregates-${stamp}.csv`, toCsv(d.health), "text/csv");
      download(`priority-aggregates-${stamp}.csv`, toCsv(d.priorities), "text/csv");
      return;
    }
    download(`${kind}-${stamp}.csv`, toCsv(data as Record<string, unknown>[]), "text/csv");
  } catch (e) {
    toast.error((e as Error).message);
  }
}

export function Export() {
  return (
    <div className="flex flex-col gap-4">
      <Notice>
        General exports never include anonymous authors' identities, individual ratings or rankings, or IP addresses.
        The security log is exported separately from Access & Security. Every export is recorded in the audit log.
      </Notice>
      <div className="grid gap-4 md:grid-cols-2">
        {KINDS.map((k) => (
          <Card key={k.kind}>
            <CardHeader><CardTitle>{k.title}</CardTitle><CardDescription>{k.desc}</CardDescription></CardHeader>
            <CardContent className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => run(k.kind, "csv")}><Download /> CSV</Button>
              <Button size="sm" variant="outline" onClick={() => run(k.kind, "json")}><Download /> JSON</Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
