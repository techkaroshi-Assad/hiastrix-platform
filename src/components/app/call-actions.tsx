/**
 * What the agent did on a call, next to what it said.
 *
 * A transcript reads convincingly whether or not anything happened, which is
 * the whole problem: an agent can tell somebody their appointment is booked in
 * a perfectly natural sentence and never have called the booking tool. This is
 * the other half of the record — every tool call, its arguments, what came
 * back, and how long it took.
 *
 * A server component. There is no interaction here beyond expanding a row,
 * which `<details>` does without a line of JavaScript.
 */

import { Card, Pill } from "@/components/app/table"
import { duration } from "@/lib/format"
import {
  labelFor,
  argsSummary,
  actionSummary,
  TOOL_SLOW_MS,
  TOOL_TIMEOUT_MS,
  type CallAction,
  type UnbackedClaim,
} from "@/lib/calls/actions"

const TONE = {
  ok:      "success",
  refused: "warning",
  failed:  "danger",
} as const

const OUTCOME_WORD = {
  ok:      "Done",
  refused: "Refused",
  failed:  "Failed",
} as const

export function CallActions({
  actions,
  claims,
}: {
  actions: CallAction[]
  claims: UnbackedClaim[]
}) {
  const sum = actionSummary(actions)

  if (actions.length === 0 && claims.length === 0) {
    return (
      <Card title="What the agent did">
        <p className="px-5 py-5 text-[13px] text-subtle">
          This agent has no tools switched on, so there was nothing for it to do
          beyond talk.
        </p>
      </Card>
    )
  }

  return (
    <Card
      title="What the agent did"
      action={
        <span className="text-[12px] text-subtle">
          {sum.total} action{sum.total === 1 ? "" : "s"}
          {sum.failed > 0 && <span className="text-danger"> · {sum.failed} failed</span>}
          {sum.refused > 0 && <span className="text-warning"> · {sum.refused} refused</span>}
        </span>
      }
    >
      <div className="space-y-4 px-5 py-5">
        {/*
          The finding that matters most, so it goes first and it is phrased as
          what the caller was told rather than as a rule violation.
        */}
        {claims.length > 0 && (
          <div className="rounded-field border border-danger/40 bg-danger/[0.07] px-4 py-3.5">
            <p className="text-[13px] font-semibold text-danger">
              The agent said things that didn&rsquo;t happen
            </p>
            <ul className="mt-2.5 space-y-2.5">
              {claims.map((c, i) => (
                <li key={i} className="text-[13px] leading-relaxed">
                  <span className="text-muted">&ldquo;{c.said}&rdquo;</span>
                  <span className="block text-[12.5px] text-danger">
                    — but {c.missing}
                    {c.secondsFromStart !== null &&
                      ` (at ${duration(Math.round(c.secondsFromStart))})`}
                    .
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[12px] leading-relaxed text-subtle">
              The caller left this call believing something that isn&rsquo;t in
              your CRM. If this keeps happening, it usually means a tool failed
              mid-call, or the agent has no tool for what it was promising.
            </p>
          </div>
        )}

        {actions.length === 0 ? (
          <p className="text-[13px] text-subtle">No tools were called on this call.</p>
        ) : (
          <ol className="space-y-2">
            {actions.map(action => {
              const slow =
                action.latencyMs !== null && action.latencyMs >= TOOL_SLOW_MS
              const timedOut =
                action.latencyMs !== null && action.latencyMs >= TOOL_TIMEOUT_MS

              return (
                <li
                  key={action.id}
                  className="rounded-field border border-line bg-field-soft px-4 py-3"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <div className="flex items-baseline gap-2.5">
                      {action.secondsFromStart !== null && (
                        <span className="text-[11px] tabular-nums text-subtle">
                          {duration(Math.round(action.secondsFromStart))}
                        </span>
                      )}
                      <span className="text-[13.5px] font-medium">{labelFor(action)}</span>
                      <span className="text-[11.5px] text-subtle">{action.name}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      {action.latencyMs !== null && (
                        <span
                          className={
                            timedOut
                              ? "text-[11px] tabular-nums text-danger"
                              : slow
                                ? "text-[11px] tabular-nums text-warning"
                                : "text-[11px] tabular-nums text-subtle"
                          }
                          // Eight seconds is the provider's ceiling, so the
                          // number only means anything against that.
                          title={`The voice provider gives a tool ${TOOL_TIMEOUT_MS / 1000} seconds to answer`}
                        >
                          {(action.latencyMs / 1000).toFixed(1)}s
                        </span>
                      )}
                      <Pill tone={TONE[action.outcome]}>{OUTCOME_WORD[action.outcome]}</Pill>
                    </div>
                  </div>

                  {argsSummary(action) && (
                    <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
                      {argsSummary(action)}
                    </p>
                  )}

                  {action.result !== null ? (
                    <p
                      className={
                        action.outcome === "failed"
                          ? "mt-1.5 text-[12.5px] leading-relaxed text-danger"
                          : "mt-1.5 text-[12.5px] leading-relaxed text-subtle"
                      }
                    >
                      {action.result}
                    </p>
                  ) : (
                    <p className="mt-1.5 text-[12.5px] leading-relaxed text-danger">
                      Never came back. The agent carried on without an answer.
                    </p>
                  )}

                  {/* Everything that was sent, for when the summary isn't enough. */}
                  {action.argsRaw && action.argsRaw !== "{}" && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[11.5px] text-subtle transition-colors hover:text-fg">
                        Everything sent
                      </summary>
                      <pre className="mt-1.5 overflow-x-auto rounded-field bg-field px-3 py-2 text-[11.5px] leading-relaxed text-muted">
                        {action.argsRaw}
                      </pre>
                    </details>
                  )}
                </li>
              )
            })}
          </ol>
        )}

        {sum.slowest !== null && sum.slowest >= TOOL_SLOW_MS && (
          <p className="text-[12px] leading-relaxed text-subtle">
            The slowest action took {(sum.slowest / 1000).toFixed(1)} seconds. The
            voice provider abandons a tool call at {TOOL_TIMEOUT_MS / 1000}, and
            the agent then has to apologise mid-sentence — worth telling us about
            if you see it often.
          </p>
        )}
      </div>
    </Card>
  )
}
