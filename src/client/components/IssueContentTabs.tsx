/** Primary issue content grouped into count-aware, keyboard-accessible tabs. */
import { useCallback, useState } from "react";
import { AlertCircle, LoaderCircle } from "lucide-react";
import type { IssueDto } from "../../shared/contracts/issues";
import { AttachmentSection, type AttachmentLoadState } from "./AttachmentUploader";
import { BacklinksPanel, type BacklinksLoadState } from "./BacklinksPanel";
import { IssueLinkPreview } from "./IssueLinkPreview";
import { ReminderEditor, type ReminderLoadState } from "./ReminderEditor";
import { SubIssuesPanel, type SubIssuesLoadState } from "./SubIssuesPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { cn } from "@/lib/utils";

type CountState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; count: number; completed?: number };

export function IssueContentTabs({ issue }: { issue: IssueDto }) {
  const [subIssues, setSubIssues] = useState<CountState>({
    status: "ready",
    count: issue.child_count,
  });
  const [backlinks, setBacklinks] = useState<CountState>({
    status: "ready",
    count: issue.backlink_count,
  });
  const [attachments, setAttachments] = useState<CountState>({ status: "loading" });
  const [reminders, setReminders] = useState<CountState>({ status: "loading" });

  const onSubIssuesChange = useCallback((state: SubIssuesLoadState) => setSubIssues(state), []);
  const onBacklinksChange = useCallback((state: BacklinksLoadState) => setBacklinks(state), []);
  const onAttachmentsChange = useCallback((state: AttachmentLoadState) => setAttachments(state), []);
  const onRemindersChange = useCallback((state: ReminderLoadState) => setReminders(state), []);

  return (
    <IssueLinkPreview>
      <section className="issue-content-tabs overflow-hidden rounded-lg border border-border bg-card" aria-label="Issue content">
        <Tabs defaultValue="sub-issues">
          <TabsList className="w-full justify-start overflow-x-auto border-b border-border bg-muted/30 px-2" aria-label="Issue content">
            <ContentTab value="sub-issues" label="Sub-issues" state={subIssues} className="sub-issues-header" />
            <ContentTab value="backlinks" label="Backlinks" state={backlinks} />
            <ContentTab value="attachments" label="Attachments" state={attachments} />
            <ContentTab value="reminders" label="Reminders" state={reminders} />
          </TabsList>

          {/* Force-mount all panels so every tab can report whether it has content. */}
          <TabsContent value="sub-issues" forceMount>
            <SubIssuesPanel
              issueRef={issue.number.toString()}
              rootId={issue.id}
              onLoadStateChange={onSubIssuesChange}
            />
          </TabsContent>
          <TabsContent value="backlinks" forceMount className="p-3">
            <BacklinksPanel issueRef={issue.number.toString()} onLoadStateChange={onBacklinksChange} />
          </TabsContent>
          <TabsContent value="attachments" forceMount className="p-3">
            <AttachmentSection
              ownerType="issue"
              ownerId={issue.id}
              uploadUrl={`/api/attachments/issue/${issue.number}`}
              onLoadStateChange={onAttachmentsChange}
            />
          </TabsContent>
          <TabsContent value="reminders" forceMount className="p-3">
            <ReminderEditor
              issueRef={issue.number.toString()}
              issue={issue}
              embedded
              wide
              onLoadStateChange={onRemindersChange}
            />
          </TabsContent>
        </Tabs>
      </section>
    </IssueLinkPreview>
  );
}

function ContentTab({
  value,
  label,
  state,
  className,
}: {
  value: string;
  label: string;
  state: CountState;
  className?: string;
}) {
  return (
    <TabsTrigger value={value} className={className} aria-label={tabLabel(label, state)}>
      {label}
      <TabIndicator state={state} subIssues={value === "sub-issues"} />
    </TabsTrigger>
  );
}

function TabIndicator({ state, subIssues }: { state: CountState; subIssues: boolean }) {
  if (state.status === "loading") {
    return (
      <span className="inline-flex size-5 items-center justify-center text-muted-foreground" aria-hidden="true">
        <LoaderCircle className="size-3.5 animate-spin" />
      </span>
    );
  }
  if (state.status === "error") {
    return (
      <span className="inline-flex size-5 items-center justify-center text-destructive" aria-hidden="true">
        <AlertCircle className="size-3.5" />
      </span>
    );
  }

  const complete = subIssues && state.count > 0 && state.completed === state.count;
  const text = subIssues && state.count > 0 && state.completed !== undefined
    ? `${state.completed}/${state.count}`
    : String(state.count);
  return (
    <span
      className={cn(
        "inline-flex min-w-5 items-center justify-center rounded-full border border-border px-1.5 py-px text-[11px] font-medium text-muted-foreground",
        subIssues && "sub-issues-progress",
        complete && "border-success/40 text-success",
      )}
      aria-hidden="true"
    >
      {text}
    </span>
  );
}

function tabLabel(label: string, state: CountState): string {
  if (state.status === "loading") return `${label}, loading`;
  if (state.status === "error") return `${label}, could not load`;
  const noun = state.count === 1 ? "item" : "items";
  if (state.completed !== undefined && state.count > 0) {
    return `${label}, ${state.count} ${noun}, ${state.completed} completed`;
  }
  return `${label}, ${state.count} ${noun}`;
}
