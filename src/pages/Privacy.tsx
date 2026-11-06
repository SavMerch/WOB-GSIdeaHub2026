import { Link } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { AuthLayout } from "./public";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line py-5">
      <h2 className="mb-2 font-display text-base font-semibold">{title}</h2>
      <div className="flex flex-col gap-2 text-sm leading-relaxed text-ink-soft">{children}</div>
    </section>
  );
}

export function PrivacyContent() {
  const { settings } = useAuth();
  const days = settings?.log_retention_days ?? 30;
  const threshold = settings?.privacy_threshold ?? 3;
  return (
    <article>
      <h1 className="mb-2 font-display text-2xl font-semibold">Privacy & trust</h1>
      <p className="mb-4 text-ink-soft">
        This workspace is for candid conversations. Here is exactly what is shared, with whom, and what isn't.
      </p>
      <Section title="Who can get in">
        <p>Only invited people whose accounts an administrator has approved. The shared invitation password lets someone <em>request</em> an account; it doesn't grant access to anything. Administrators can pause or remove access at any time, and it takes effect immediately.</p>
      </Section>
      <Section title="Business units">
        <p>Each business unit has its own space. You see only the unit(s) you're assigned to — other units can't see your unit's posts, discussions, roadmap, or 2027 plans, and you can't see theirs. This is enforced by the database, not just by the screens.</p>
        <p>A small cross-cutting group (and administrators) can see every unit and an Executive View that combines results into Corporate Solutions and Government Solutions. That view shows group results only — individual ratings and rankings are never shown — and a unit with too few responses is left out of the totals so its answers can't be worked out by subtraction.</p>
      </Section>
      <Section title="What's attributed to you">
        <p>Ideas, comments, reactions counts, roadmap volunteering, and your username are visible to other members. Who reacted to what is not shown to anyone — only totals.</p>
      </Section>
      <Section title="How anonymous posts work">
        <p>When you share anonymously, your account is not stored with the post at all — there is no hidden author field, so it can't be revealed in the app, the database, exports, or live updates. That also means you can't edit or delete it afterward.</p>
        <p><strong className="text-ink">In a small group, anonymity can't be absolutely guaranteed.</strong> Writing style, details, or the timing of a post can make it recognizable. The people who operate the hosting platform could, in principle, correlate server request logs with timing. Please share with that in mind.</p>
      </Section>
      <Section title="Your ratings and rankings">
        <p>Your health ratings, priority rankings, and experience ratings are visible only to you — not to other members and not to administrators. The group sees averages and distributions only once at least {threshold} people have responded. Results are rounded and can't be filtered by person or group.</p>
        <p>Your answers to the personal-priorities exercise, including anything about compensation or career, are never displayed individually.</p>
      </Section>
      <Section title="What sign-in activity is recorded">
        <p>For security, the system records sign-ins, failed sign-in attempts, invitation-password attempts, account requests, and periodic signs of an active session, with the network (IP) address and browser type reported by our hosting provider. An IP address identifies a network, not a person or device — offices, mobile carriers, and VPNs share them.</p>
        <p>This is used for access security only, not to monitor productivity. Only administrators can see it, and it is deleted automatically after {days} days.</p>
      </Section>
      <Section title="What administrators can do">
        <p>Administrators approve and manage accounts, moderate content (hide, archive, or remove), and export workspace content — ideas, comments, roadmap actions, and group-level results. Exports never include anonymous authors' identities, individual ratings or rankings, or IP addresses. Security logs are exported separately and only by administrators.</p>
      </Section>
      <Section title="How long things are kept">
        <p>Contributions and discussions stay until their author or an administrator removes them. Security logs are kept for {days} days. Removing your account removes your profile and private answers.</p>
      </Section>
    </article>
  );
}

export function PublicPrivacyPage() {
  return (
    <AuthLayout wide>
      <div className="rounded-2xl border border-line bg-surface p-6 sm:p-8">
        <PrivacyContent />
        <p className="mt-4 text-sm"><Link to="/" className="font-medium text-brand hover:underline">← Back</Link></p>
      </div>
    </AuthLayout>
  );
}
