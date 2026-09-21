/**
 * What the calls produced — the section a sales lead actually reads.
 *
 * Server component. Rendered on a campaign's own page for that campaign,
 * and on Analytics across every campaign. Same numbers from the same rows
 * (lib/campaigns/insights.ts), so the two never disagree.
 *
 * The honest connect rate lives here: "reached a person" is
 * `calls.reached = 'HUMAN'`, not ten seconds of audio, which is how a menu
 * used to count as a conversation.
 */

import Link from "next/link"
import { StatCard } from "@/components/app/app-shell"
import { Card, Table, TH, TD, EmptyRow, Pill } from "@/components/app/table"
import { Donut, HBarList } from "@/components/app/charts"
import { IconConnected, IconAgents, IconRate, IconGauge, IconDownload } from "@/components/app/icons"
import { usd } from "@/lib/format"
import { REACHED_LABEL } from "@/lib/calls/reached"
import type { CampaignOutcomes, CallOutcomeRow } from "@/lib/campaigns/insights"

const INTEREST_LABEL = {
  interested: "Interested",
  maybe: "Maybe / later",
  "not-interested": "Not interested",
  unknown: "Not recorded",
} as const

const NEXT_LABEL = {
  "call-back": "Call back",
  "send-info": "Send information",
  "remove-from-list": "Remove from list",
  done: "Nothing further",
  unknown: "Not recorded",
} as const

function pct(n: number, of: number): string {
  return of > 0 ? `${Math.round((n / of) * 100)}%` : "—"
}

export function CampaignOutcomesSection({
  o,
  callbacks,
  reportHref,
  pdfHref,
  /** True when the agent behind these calls doesn't use the outbound preset. */
  noExtraction,
  agentHref,
}: {
  o: CampaignOutcomes
  callbacks: CallOutcomeRow[]
  reportHref: string
  /** The PDF activity report over the same window, when the page has one. */
  pdfHref?: string
  noExtraction: boolean
  agentHref?: string
}) {
  const humans = o.reached.HUMAN
  const answered = humans + o.reached.VOICEMAIL + o.reached.IVR

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold tracking-[-0.01em]">What the calls produced</h2>
          <p className="mt-0.5 text-[12.5px] text-subtle">
            Counted from who actually picked up, not from call length — a phone menu is not a conversation.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {pdfHref && (
            <Link
              href={pdfHref}
              className="inline-flex h-9 items-center gap-2 rounded-field border border-brand-500/60 bg-brand-500/12 px-3.5 text-[12.5px] font-medium text-brand-on-tint transition-colors hover:bg-brand-500/20"
            >
              <IconDownload size={14} />
              PDF report
            </Link>
          )}
          <Link
            href={reportHref}
            className="inline-flex h-9 items-center gap-2 rounded-field border border-line bg-field px-3.5 text-[12.5px] font-medium text-fg transition-colors hover:border-line-strong hover:bg-field-hover"
          >
            <IconDownload size={14} />
            Excel (every call)
          </Link>
        </div>
      </div>

      {noExtraction && humans > 0 && (
        <div className="rounded-2xl border border-warning/30 bg-warning/[0.06] px-5 py-4">
          <p className="text-[13px] font-medium text-warning">Interest and callbacks aren&rsquo;t being recorded</p>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">
            The agent isn&rsquo;t pulling out the outbound fields after each call, so
            decision-maker, interest and callback figures below show as &ldquo;not
            recorded&rdquo;. Open the agent &rarr; After the call &rarr; Pull out specific
            details, and start from the <strong>Outbound cold call</strong> preset.
            {agentHref && (
              <>
                {" "}
                <Link href={agentHref} className="underline decoration-warning/50 underline-offset-2">Open the agent</Link>.
              </>
            )}
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Reached a person"
          value={pct(humans, o.dials)}
          meta={`${humans.toLocaleString()} of ${o.dials.toLocaleString()} calls${o.refusedBeforeDial ? ` · ${o.refusedBeforeDial} refused before dialing` : ""}`}
          icon={<IconConnected size={16} />}
        />
        <StatCard
          label="Decision-makers"
          value={o.decisionMakers.toLocaleString()}
          meta={humans > 0 ? `${pct(o.decisionMakers, humans)} of people reached · ${o.gatekeepers} stopped at reception` : "Nobody reached yet"}
          icon={<IconAgents size={16} />}
        />
        <StatCard
          label="Interested"
          value={(o.interest.interested + o.interest.maybe).toLocaleString()}
          meta={`${o.interest.interested} yes · ${o.interest.maybe} maybe · ${o.interest["not-interested"]} no`}
          icon={<IconRate size={16} />}
        />
        <StatCard
          label="Callbacks owed"
          value={o.callbacksRequested.toLocaleString()}
          meta={`${o.minutes.toLocaleString()} minutes on these calls${o.costCents > 0 ? ` · ${usd(o.costCents)} of that was overage` : ""}`}
          icon={<IconGauge size={16} />}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="What picked up">
          <Donut
            label="What picked up"
            rows={(Object.keys(o.reached) as (keyof typeof o.reached)[])
              .map(k => ({ label: REACHED_LABEL[k], value: o.reached[k] }))
              .filter(r => r.value > 0)}
            centreValue={o.dials.toLocaleString()}
            centreLabel="dials"
          />
          {o.refusedBeforeDial > 0 && (
            <p className="px-5 pb-2 text-[12px] leading-relaxed text-warning">
              {o.refusedBeforeDial.toLocaleString()} more attempt{o.refusedBeforeDial === 1 ? "" : "s"} never became a call — the
              provider refused to start {o.refusedBeforeDial === 1 ? "it" : "them"}
              {o.refusedReason ? `: "${o.refusedReason}"` : "."} Those people are back in the queue, not counted as reached or failed.
            </p>
          )}
          {o.ivrSeen > 0 && (
            <p className="px-5 pb-4 text-[12px] leading-relaxed text-subtle">
              A phone menu answered on {o.ivrSeen} of {answered} answered calls
              {humans > 0 ? ` — ${o.ivrSeen - o.reached.IVR > 0 ? o.ivrSeen - o.reached.IVR : 0} of those still got through to a person.` : "."}
            </p>
          )}
        </Card>

        <Card title="Interest, where a person was reached">
          <HBarList
            label="Interest"
            rainbow
            rows={(Object.keys(o.interest) as (keyof typeof o.interest)[])
              .map(k => ({ label: INTEREST_LABEL[k], value: o.interest[k] }))}
          />
        </Card>

        <Card title="What happens next">
          <HBarList
            label="Next action"
            colour={1}
            rows={(Object.keys(o.nextAction) as (keyof typeof o.nextAction)[])
              .map(k => ({ label: NEXT_LABEL[k], value: o.nextAction[k] }))}
          />
        </Card>
      </div>

      <Card
        title="Callbacks to make"
        action={<span className="text-[12.5px] text-subtle">{callbacks.length} owed</span>}
      >
        <Table>
          <thead>
            <tr>
              <TH>Who</TH>
              <TH>When they said</TH>
              <TH>Reach them on</TH>
              <TH>Interest</TH>
              <TH align="right">Call</TH>
            </tr>
          </thead>
          <tbody>
            {callbacks.length === 0 ? (
              <EmptyRow colSpan={5}>No callbacks requested in this range.</EmptyRow>
            ) : (
              callbacks.slice(0, 25).map(r => (
                <tr key={r.callId} className="transition-colors hover:bg-field-soft">
                  <TD>
                    <span className="font-medium">{r.contactName ?? r.leadName ?? "Unknown"}</span>
                    {r.contactRole && <span className="text-subtle"> · {r.contactRole}</span>}
                    <div className="text-[12px] text-subtle">{r.campaignName}</div>
                  </TD>
                  <TD muted>{r.callbackWhen ?? "—"}</TD>
                  <TD className="tabular-nums">{r.bestNumber ?? r.phone ?? "—"}</TD>
                  <TD>
                    <Pill tone={r.interest === "interested" ? "success" : r.interest === "maybe" ? "warning" : "neutral"}>
                      {INTEREST_LABEL[r.interest]}
                    </Pill>
                  </TD>
                  <TD align="right">
                    <Link href={`/dashboard/calls/${r.callId}`} className="text-[12.5px] text-brand-on-tint underline-offset-2 hover:underline">
                      Open
                    </Link>
                  </TD>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </Card>
    </div>
  )
}
