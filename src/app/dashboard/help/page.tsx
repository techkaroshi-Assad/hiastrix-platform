import type { Metadata } from "next"
import Link from "next/link"
import { requireTenant } from "@/lib/tenant"
import { Page } from "@/components/app/app-shell"
import { prisma } from "@/lib/prisma"

export const metadata: Metadata = { title: "Help" }
export const dynamic = "force-dynamic"

/**
 * The guide.
 *
 * Written for whoever signs up, not for us. Two rules held throughout:
 *
 *   · Nothing here names a vendor. A tenant has no idea what our voice provider
 *     or our CRM is called, and it is none of their business — the same rule the
 *     rest of the product follows.
 *
 *   · It explains consequences rather than controls. "Click Start to start" is
 *     not help. What a person actually needs to know is that pausing lets calls
 *     already connected finish, that the calling window is in the recipient's
 *     time zone and not theirs, and that running out of balance stops a campaign
 *     without losing its place.
 */

/* ── Small presentational pieces, local to this page ───────────────────── */

function Topic({
  id, title, children,
}: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-8 rounded-2xl border border-line bg-field-soft">
      <header className="border-b border-line px-6 py-4">
        <h2 className="text-[15px] font-medium tracking-[-0.01em]">{title}</h2>
      </header>
      <div className="space-y-4 px-6 py-5 text-[13.5px] font-light leading-relaxed text-muted">
        {children}
      </div>
    </section>
  )
}

function Q({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[13.5px] font-medium text-fg">{q}</p>
      <div className="mt-1.5 space-y-2">{children}</div>
    </div>
  )
}

const TOPICS = [
  ["getting-started", "Getting started"],
  ["agents", "Agents"],
  ["numbers", "Phone numbers"],
  ["campaigns", "Outbound campaigns"],
  ["lists", "Lists and do-not-call"],
  ["calls", "Calls and analytics"],
  ["billing", "Minutes and billing"],
  ["team", "Your team"],
  ["trouble", "When something isn't working"],
] as const

export default async function HelpPage() {
  const { tenant, email } = await requireTenant()

  // The one number worth pulling: support address is configurable, and a guide
  // that tells people to email the wrong place is worse than one that doesn't.
  const settings = await prisma.platformSettings.findFirst({
    where:  { id: true },
    select: { supportEmail: true },
  })
  const support = settings?.supportEmail ?? "support@hiastrix.com"

  return (
    <Page
      heading="Help"
      description="How the platform works, what each setting actually does, and what to do when something looks wrong."
    >
      <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        {/* Contents. Plain anchors — no state, no JavaScript. */}
        <nav aria-label="Topics" className="lg:sticky lg:top-8 lg:self-start">
          <ul className="space-y-0.5">
            {TOPICS.map(([id, label]) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  className="block rounded-sm px-3 py-1.5 text-[13px] text-muted transition-colors hover:bg-field-soft hover:text-fg"
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="max-w-[760px] space-y-5">

          <Topic id="getting-started" title="Getting started">
            <p>
              Hi-Astrix gives you AI agents that answer your phone and make calls for you.
              An agent is a voice, a personality and a set of things it&rsquo;s allowed to
              do. You point a phone number at it so it can take calls, and you can give it a
              list of people to ring.
            </p>
            <p>Three steps, in order:</p>
            <ol className="ml-4 list-decimal space-y-1.5 marker:text-subtle">
              <li>
                Create an agent on the{" "}
                <Link href="/dashboard/agents" className="text-brand-on-tint hover:underline">Agents</Link>{" "}
                page and give it a first message and some instructions.
              </li>
              <li>
                Attach one of your{" "}
                <Link href="/dashboard/numbers" className="text-brand-on-tint hover:underline">phone numbers</Link>{" "}
                to it, so callers reach it and it has something to show as the caller when it rings out.
              </li>
              <li>Test it — call your own phone from the agent — before pointing anyone else at it.</li>
            </ol>
            <p>
              Nothing you set up starts costing money until a call actually connects.
              Building agents, writing lists and setting up campaigns are all free.
            </p>
          </Topic>

          <Topic id="agents" title="Agents">
            <p>
              An agent handles both directions. The same agent answers people who call your
              number and makes the calls in a campaign — you don&rsquo;t need one of each.
            </p>
            <Q q="What should go in the instructions?">
              <p>
                Tell it who it is, who it works for, and what it&rsquo;s trying to achieve —
                the way you&rsquo;d brief a new starter on their first morning. Be specific
                about what it must not do. &ldquo;Never quote a price&rdquo; works; hoping it
                won&rsquo;t doesn&rsquo;t.
              </p>
            </Q>
            <Q q="What are tools?">
              <p>
                Tools let the agent do things during a call rather than just talk — look
                someone up in your CRM, add a note, create a lead, move them along a
                pipeline, check your calendar, book an appointment.
              </p>
              <p>
                Switching a tool on gives the agent the ability. It doesn&rsquo;t make it use
                it well, so say in the instructions when you want it used. Some tools depend
                on others, and the builder tells you when that&rsquo;s the case.
              </p>
            </Q>
            <Q q="Turning an agent off">
              <p>
                An agent that&rsquo;s off stops answering — its numbers are taken off the air
                — and can&rsquo;t make outbound calls. Turn it back on and its numbers come
                back. Nothing is lost either way.
              </p>
            </Q>
            <Q q="Voicemail detection">
              <p>
                Off by default, and worth turning on before you run a campaign. Without it,
                the agent can&rsquo;t tell an answering machine from a person: it holds a full
                conversation with the answerphone, and that gets recorded as somebody you
                spoke to. Your results look better than they are.
              </p>
            </Q>
          </Topic>

          <Topic id="numbers" title="Phone numbers">
            <p>
              Numbers are allocated to your workspace by us — you can&rsquo;t buy one from
              inside the app. Once you have one, you decide which agent answers it.
            </p>
            <Q q="Can one agent have several numbers?">
              <p>
                Yes, and for outbound work it&rsquo;s worth it. Phone companies flag a single
                number that makes hundreds of calls a day as spam, and once that happens
                people stop answering. Spreading a campaign across a few numbers keeps them
                healthy. A campaign rotates automatically unless you pin it to one.
              </p>
            </Q>
            <Q q="Can two agents share a number?">
              <p>
                No. A number rings one agent — otherwise there&rsquo;d be no way to say who
                should pick up. You can move a number between agents whenever you like.
              </p>
            </Q>
          </Topic>

          <Topic id="campaigns" title="Outbound campaigns">
            <p>
              A campaign is a list of people and an agent to call them. You upload the list,
              set the hours it&rsquo;s allowed to call, and press start — it works through
              the list on its own, retries the ones who didn&rsquo;t pick up, and stops when
              it&rsquo;s done.
            </p>
            <Q q="Nothing is dialled until you start it">
              <p>
                Creating a campaign and adding people to it never rings anybody. The campaign
                sits as a draft until you press <span className="text-fg">Start calling</span>.
              </p>
            </Q>
            <Q q="The calling window is in their time zone, not yours">
              <p>
                This is the setting people get wrong. 9am–7pm means 9am–7pm where the person
                being called lives. Choose the zone your list is actually in.
              </p>
              <p>
                Anybody who comes due outside those hours waits for the next opening rather
                than being skipped, so a campaign left running overnight simply picks up in
                the morning.
              </p>
            </Q>
            <Q q="Calls at once, and attempts per person">
              <p>
                <span className="text-fg">Calls at once</span> is how many people the agent
                talks to simultaneously. Higher gets through a list faster and spends your
                balance faster.
              </p>
              <p>
                <span className="text-fg">Attempts per person</span> is how many times it
                tries somebody before giving up. A busy line is retried much sooner than an
                unanswered one — busy means they&rsquo;re there.
              </p>
            </Q>
            <Q q="Pausing">
              <p>
                Pausing stops new calls being started. Calls already connected are allowed to
                finish — hanging up on somebody mid-sentence would be worse than letting the
                call end.
              </p>
              <p>
                Nothing is lost. Every person keeps their place, their attempt count and when
                they&rsquo;re next due, so resuming carries on exactly where it stopped
                rather than starting the list again.
              </p>
            </Q>
            <Q q="Editing a running campaign">
              <p>
                You can change the hours, the days, how many calls at once and the retry
                settings while it&rsquo;s running. Changes take effect on the next call — you
                don&rsquo;t need to stop it. The agent can&rsquo;t be swapped; make a new
                campaign for that.
              </p>
            </Q>
            <Q q="Deleting versus archiving">
              <p>
                A campaign that hasn&rsquo;t called anybody yet can be deleted outright.
                Once it&rsquo;s made calls it can only be archived, because those calls are
                in your history and deleting the campaign would leave them with nothing to
                belong to. Archiving cancels anyone still waiting and keeps the record.
              </p>
            </Q>
            <Q q="What the statuses mean">
              <ul className="ml-4 list-disc space-y-1 marker:text-subtle">
                <li><span className="text-fg">Waiting</span> — not called yet.</li>
                <li><span className="text-fg">Calling</span> / <span className="text-fg">On the call</span> — happening right now.</li>
                <li><span className="text-fg">Spoke to them</span> — a real conversation.</li>
                <li><span className="text-fg">Trying again later</span> — no answer or busy; it&rsquo;ll come back to them.</li>
                <li><span className="text-fg">Outside calling hours</span> — due, but waiting for the window to reopen.</li>
                <li><span className="text-fg">No answer</span> — every attempt used, never picked up.</li>
                <li><span className="text-fg">Couldn&rsquo;t reach</span> — the number doesn&rsquo;t work.</li>
                <li><span className="text-fg">Do not call</span> — on your suppression list, or they asked not to be called.</li>
              </ul>
            </Q>
          </Topic>

          <Topic id="lists" title="Lists and do-not-call">
            <Q q="Uploading a spreadsheet">
              <p>
                Save it as a CSV with a header row. You&rsquo;ll be shown the first few rows
                and asked which column holds the phone number, so you can check it&rsquo;s
                read your file the way you expect before anything is added.
              </p>
              <p>
                The file is read on your own computer — only the rows we can use are sent.
              </p>
            </Q>
            <Q q="What happens to messy data">
              <p>
                Numbers are tidied into one standard format, so the same person written three
                different ways is added once, not called three times. Anyone already on your
                do-not-call list is dropped. Rows that aren&rsquo;t usable phone numbers are
                listed back to you with their line number so you can fix the file.
              </p>
              <p>
                Uploading the same file twice is safe — it adds nobody a second time.
              </p>
            </Q>
            <Q q="Numbers without a country code">
              <p>
                Anything written without one is assumed to be in your workspace&rsquo;s
                default country. If your list is from somewhere else, either write the numbers
                in full international format or ask us to change the default.
              </p>
            </Q>
            <Q q="Pulling a list from your CRM">
              <p>
                If your CRM is connected, you can pull everyone carrying a particular tag.
                It&rsquo;s a snapshot taken when you pull it — tagging somebody afterwards
                won&rsquo;t quietly add them to a campaign that&rsquo;s already running.
              </p>
            </Q>
            <Q q="The do-not-call list">
              <p>
                Numbers on it are never dialled by any of your campaigns, are dropped from
                every list you upload, and are pulled out of anything already queued the
                moment you add them.
              </p>
              <p>
                People are added to it automatically when a call is refused or they ask not
                to be contacted again. You can add numbers yourself by pasting them in, one
                per line.
              </p>
            </Q>
            <Q q="Protections you don't have to set up">
              <p>
                Nobody is called more than twice in twenty-four hours, however many campaigns
                they appear in. Two campaigns can never ring the same person at the same
                moment. And every outbound call opens by saying who&rsquo;s calling and that
                it may be recorded.
              </p>
            </Q>
          </Topic>

          <Topic id="calls" title="Calls and analytics">
            <p>
              Every call — answered, made, or tested — appears in{" "}
              <Link href="/dashboard/calls" className="text-brand-on-tint hover:underline">Calls</Link>{" "}
              with its recording, transcript and a short summary of what happened.
            </p>
            <Q q="Why a call sometimes takes a moment to appear">
              <p>
                A call is written up once it ends and the recording and transcript have been
                processed. That&rsquo;s usually seconds, occasionally a minute on a long call.
              </p>
            </Q>
            <Q q="Analytics">
              <p>
                <Link href="/dashboard/analytics" className="text-brand-on-tint hover:underline">Analytics</Link>{" "}
                shows volume, minutes and cost over time, along with how calls ended. Where an
                agent has success evaluation switched on, you&rsquo;ll also see how many calls
                met the goal — with the number of calls actually assessed, rather than a
                percentage of everything.
              </p>
            </Q>
          </Topic>

          <Topic id="billing" title="Minutes and billing">
            <p>
              You&rsquo;re charged for the minutes you use. A plan includes an allowance at a
              lower rate; anything past it comes out of your balance at the plan&rsquo;s
              overage rate. Without a plan, every minute comes out of your balance.
            </p>
            <Q q="Every figure is shown both ways">
              <p>
                Minutes and money, side by side. &ldquo;$1.30 left&rdquo; on its own
                doesn&rsquo;t tell you whether that&rsquo;s an afternoon or a fortnight.
              </p>
            </Q>
            <Q q="What happens when the balance runs out">
              <p>
                Calls stop. Your agents stop answering and any running campaign pauses — with
                its queue intact. Top up and everything comes back on, campaigns included,
                carrying on from exactly where they stopped.
              </p>
              <p>
                A campaign you paused yourself stays paused. Topping up doesn&rsquo;t restart
                something you deliberately stopped.
              </p>
            </Q>
            <Q q="Test calls cost the same">
              <p>
                A test call uses the same minutes as a real one, so it&rsquo;s billed the
                same way.
              </p>
            </Q>
          </Topic>

          <Topic id="team" title="Your team">
            <p>
              Invite colleagues from{" "}
              <Link href="/dashboard/settings" className="text-brand-on-tint hover:underline">Settings</Link>.
              They get their own sign-in and see the same workspace.
            </p>
            <p>
              The owner can change the workspace name and manage billing. Account managers can
              do everything else — build agents, run campaigns, read calls. Invitations expire,
              and you can revoke one before it&rsquo;s accepted.
            </p>
          </Topic>

          <Topic id="trouble" title="When something isn't working">
            <Q q="The campaign won't start">
              <p>
                The page tells you why, just above the buttons. Usually one of: no balance, the
                agent is switched off, the agent has no phone number attached, there&rsquo;s
                nobody left to call, or the voicemail setting needs turning on for that agent.
              </p>
            </Q>
            <Q q="It's running but nothing is happening">
              <p>
                Check the time. If you&rsquo;re outside the calling window everyone shows as
                &ldquo;outside calling hours&rdquo; and it will start on its own when the
                window opens. Remember the window is in the time zone of the people being
                called.
              </p>
            </Q>
            <Q q="An agent isn't answering its number">
              <p>
                Check the agent is switched on and that the number is still attached to it on
                the Phone numbers page. An agent that was turned off — by you, or automatically
                when the balance ran out — has its numbers taken off the air until it&rsquo;s
                turned back on.
              </p>
            </Q>
            <Q q="Fewer people were added than my file had rows">
              <p>
                The summary after an upload accounts for every row: already in this campaign,
                listed twice in the file, on your do-not-call list, or not a usable phone
                number. Open the last of those to see exactly which lines and why.
              </p>
            </Q>
            <Q q="Still stuck">
              <p>
                Email{" "}
                <a href={`mailto:${support}`} className="text-brand-on-tint hover:underline">
                  {support}
                </a>{" "}
                and tell us the workspace name{tenant.companyName ? ` (${tenant.companyName})` : ""},
                what you expected and what happened instead. If it&rsquo;s about one call,
                the time it started is enough for us to find it.
              </p>
            </Q>
          </Topic>

        </div>
      </div>
    </Page>
  )
}
