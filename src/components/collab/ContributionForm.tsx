import * as React from "react";
import { EyeOff } from "lucide-react";
import { rpc } from "@/lib/api";
import { newRequestId } from "@/lib/utils";
import type { Category, Contribution } from "@/lib/types";
import { useAction } from "@/hooks/data";
import { useUnit } from "@/hooks/useUnit";
import { Button } from "@/components/ui/button";
import { Field, Input, Notice, Select, Switch, Textarea } from "@/components/ui/primitives";
import { Dialog, DialogContent, DialogHeader } from "@/components/ui/dialog";

export interface DetailField {
  key: "context" | "interesting" | "need_to_change" | "going_for_us" | "in_the_way";
  label: string;
  placeholder?: string;
}

export interface FormConfig {
  board: string;
  heading: string;
  prompt: string;
  titleLabel: string;
  titlePlaceholder?: string;
  bodyLabel?: string;
  categories?: Category[];
  categoryLabel?: string;
  categoryRequired?: boolean;
  detailFields?: DetailField[];
  allowAnonymous?: boolean;
}

export function ContributionForm({
  open, onOpenChange, config, editing, defaultCategoryId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  config: FormConfig;
  editing?: Contribution | null;
  defaultCategoryId?: string;
}) {
  const unit = useUnit();
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const [categoryId, setCategoryId] = React.useState("");
  const [details, setDetails] = React.useState<Record<string, string>>({});
  const [anonymous, setAnonymous] = React.useState(false);
  const requestId = React.useRef(newRequestId());

  React.useEffect(() => {
    if (!open) return;
    setTitle(editing?.title ?? "");
    setBody(editing?.body ?? "");
    setCategoryId(editing?.category_id ?? defaultCategoryId ?? "");
    setDetails(editing?.details ?? {});
    setAnonymous(false);
    requestId.current = newRequestId();
  }, [open, editing, defaultCategoryId]);

  const save = useAction(
    () =>
      editing
        ? rpc("update_contribution", {
            p_id: editing.id, p_expected_version: editing.version, p_title: title, p_body: body,
            p_category_id: categoryId || null, p_details: details,
          })
        : rpc("create_contribution", {
            p_unit_id: unit.id,
            p_board: config.board, p_title: title, p_body: body, p_category_id: categoryId || null,
            p_details: details, p_anonymous: anonymous, p_client_request_id: requestId.current,
          }),
    {
      success: editing ? "Changes saved" : anonymous ? "Shared anonymously" : "Shared with the group",
      invalidate: [["contributions"], ["home"]],
      retry: !editing,
    },
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (save.isPending) return;
    save.mutate(undefined, { onSuccess: () => onOpenChange(false) });
  };
  const missingCategory = config.categoryRequired && !categoryId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader title={editing ? "Edit" : config.heading} description={config.prompt} />
        <form onSubmit={submit} className="flex flex-col gap-4">
          {config.categories && config.categories.length > 0 && (
            <Field label={config.categoryLabel ?? "Category"} htmlFor="f-cat">
              <Select id="f-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required={config.categoryRequired}>
                <option value="">{config.categoryRequired ? "Choose one…" : "No category"}</option>
                {config.categories.filter((c) => c.active || c.id === categoryId).map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </Select>
            </Field>
          )}
          <Field label={config.titleLabel} htmlFor="f-title" hint={`${title.length}/200`}>
            <Input id="f-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required placeholder={config.titlePlaceholder} autoFocus />
          </Field>
          <Field label={config.bodyLabel ?? "Anything to add? (optional)"} htmlFor="f-body">
            <Textarea id="f-body" value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} />
          </Field>
          {config.detailFields?.map((f) => (
            <Field key={f.key} label={f.label} htmlFor={`f-${f.key}`}>
              <Textarea
                id={`f-${f.key}`}
                className="min-h-[64px]"
                value={details[f.key] ?? ""}
                placeholder={f.placeholder ?? "Optional"}
                maxLength={2000}
                onChange={(e) => setDetails({ ...details, [f.key]: e.target.value })}
              />
            </Field>
          ))}
          {config.allowAnonymous && !editing && (
            <div className="rounded-xl border border-line bg-canvas p-4">
              <div className="flex items-center justify-between gap-4">
                <label htmlFor="f-anon" className="flex items-center gap-2 text-sm font-medium">
                  <EyeOff className="size-4 text-muted" aria-hidden /> Share anonymously
                </label>
                <Switch id="f-anon" checked={anonymous} onCheckedChange={setAnonymous} />
              </div>
              {anonymous && (
                <Notice tone="warn" className="mt-3">
                  Your name is not stored with an anonymous post — not even administrators can look it up, and you won't
                  be able to edit or delete it later. In a small group, though, wording or timing can sometimes make a
                  comment recognizable, so anonymity can't be absolutely guaranteed.
                </Notice>
              )}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant="brand" loading={save.isPending} disabled={!title.trim() || missingCategory}>
              {editing ? "Save changes" : anonymous ? "Share anonymously" : "Share"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
