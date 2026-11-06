import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { rpc, unwrap } from "@/lib/api";
import { useAction } from "@/hooks/data";
import { SEGMENT_LABEL, type Unit } from "@/hooks/useUnit";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Notice, Select, Spinner, Switch } from "@/components/ui/primitives";

/** Rename units, move them between Corporate and Government Solutions, or retire them. */
export function Units() {
  const { data, isLoading } = useQuery({
    queryKey: ["units", "admin"],
    queryFn: async () => unwrap(await supabase.from("business_units").select("*").order("sort")) as Unit[],
  });
  if (isLoading) return <Spinner />;
  return (
    <div className="flex flex-col gap-4">
      <Notice>
        The segment decides how a unit rolls up in the Executive View. Turning a unit off hides it from everyone's picker
        and the Executive View; its content is kept and comes back if you turn it on again.
      </Notice>
      {(data ?? []).map((u) => <UnitCard key={u.id} unit={u} />)}
    </div>
  );
}

function UnitCard({ unit }: { unit: Unit }) {
  const [v, setV] = React.useState(unit);
  React.useEffect(() => setV(unit), [unit]);
  const save = useAction(
    () => rpc("admin_upsert_unit", {
      p_id: unit.id, p_slug: null, p_name: v.name, p_short_name: v.short_name, p_segment: v.segment, p_sort: v.sort, p_active: v.active,
    }),
    { success: "Saved", invalidate: [["units"], ["exec-summary"]] },
  );
  const dirty = v.name !== unit.name || v.short_name !== unit.short_name || v.segment !== unit.segment || v.active !== unit.active || v.sort !== unit.sort;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{unit.name}</CardTitle>
        <CardDescription>Web address: /u/{unit.slug}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid items-end gap-3 md:grid-cols-[2fr_1.2fr_1.2fr_5rem_auto_auto]" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }}>
          <label className="flex flex-col gap-1 text-sm">Full name
            <Input value={v.name} maxLength={80} onChange={(e) => setV({ ...v, name: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-sm">Short name
            <Input value={v.short_name} maxLength={40} onChange={(e) => setV({ ...v, short_name: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-sm">Segment
            <Select value={v.segment} onChange={(e) => setV({ ...v, segment: e.target.value as Unit["segment"] })}>
              <option value="corporate">{SEGMENT_LABEL.corporate}</option>
              <option value="government">{SEGMENT_LABEL.government}</option>
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-sm">Order
            <Input type="number" min={0} max={99} value={v.sort} onChange={(e) => setV({ ...v, sort: Number(e.target.value) })} />
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <Switch checked={v.active} onCheckedChange={(c) => setV({ ...v, active: c })} aria-label="Active" /> Active
          </label>
          <Button type="submit" variant="brand" loading={save.isPending} disabled={!dirty}>Save</Button>
        </form>
      </CardContent>
    </Card>
  );
}
