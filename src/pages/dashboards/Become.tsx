import { DASHBOARDS } from "@/lib/dashboards";
import { Notice, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/primitives";
import { PageHeader, SectionHeader } from "@/components/collab/common";
import { ContributionBoard } from "@/components/collab/ContributionBoard";
import * as React from "react";
import { useItemBoard } from "@/hooks/data";

const D = DASHBOARDS[2];

const WHAT_IT_TAKES = [
  { key: "interesting" as const, label: "What makes this interesting?" },
  { key: "need_to_change" as const, label: "What would need to change?" },
  { key: "going_for_us" as const, label: "What do we already have going for us?" },
  { key: "in_the_way" as const, label: "What might get in the way?" },
];

export default function Become() {
  const [tab, setTab] = React.useState("known");
  const linkedBoard = useItemBoard();
  React.useEffect(() => {
    // Deep links land on the tab that holds the item
    if (linkedBoard) setTab(linkedBoard === "grow" ? "grow" : "known");
  }, [linkedBoard]);
  return (
    <div>
      <PageHeader dashboard={D} title={D.question} subtitle={D.subtitle} />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="known">What should we be known for?</TabsTrigger>
          <TabsTrigger value="grow">Where could we grow?</TabsTrigger>
        </TabsList>
        <TabsContent value="known">
          <SectionHeader letter="A" title="What Should We Be Known For?" prompt="If we were building the team we really want to be part of, what would it look like?" />
          <ContributionBoard
            board="known_for" heading="Share an idea"
            prompt="If we were building the team we really want to be part of, what would it look like?"
            titleLabel="Your idea" titlePlaceholder="e.g. The team clients call first in a crisis"
            addLabel="Share an idea" emptyTitle="What should we be known for?"
            emptyText="Identity, reputation, strengths, direction — anything goes."
            enableNominate
          />
        </TabsContent>
        <TabsContent value="grow">
          <SectionHeader letter="B" title="Where Could We Grow?" prompt="New services, markets, capabilities, partnerships — where's the opportunity?" />
          <Notice className="mb-5">
            <strong className="text-ink">C. What would it take?</strong> Each idea has optional prompts for what makes it
            interesting, what would need to change, and what might get in the way. Use <em>Connect</em> on any idea to
            link it to the barriers, capabilities, or next steps it depends on. No forecasts or business cases needed.
          </Notice>
          <ContributionBoard
            board="grow" heading="Share an idea" prompt="Where could we grow? No numbers needed — just the idea."
            titleLabel="The opportunity" titlePlaceholder="e.g. Recovery planning for mid-size cities"
            categoryLabel="Type of opportunity" detailFields={WHAT_IT_TAKES}
            addLabel="Share an idea" emptyTitle="No growth ideas yet" emptyText="What's possible if we forget the limitations for a minute?"
            enableNominate enableFilters groupByCategory
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
