/**
 * The icon vocabulary.
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────
 *
 * Screens import *meaning* — `IconCampaigns` — not a picture. That indirection
 * has now paid for itself twice: once when eleven hand-drawn SVGs were replaced
 * by a library, and again when that library was replaced by this one. Both were
 * a single-file change, and nothing else in the app knew.
 *
 * It also decides the size and the weight once, rather than in ninety call
 * sites, and it is where a white-label icon set would eventually land. The
 * brand mark stays ours and stays hand-drawn, in `brand/logo.tsx`.
 *
 * ── WHY PHOSPHOR, AND WHY BOLD ────────────────────────────────────────
 *
 * The set before this was uniform-stroke line icons. They were fine, and they
 * read as *generic* — every glyph the same weight, the same grey, no hierarchy,
 * so a sidebar of nine is nine identical marks and the eye has nothing to grip.
 *
 * The first attempt at fixing that was Phosphor's `duotone`, which adds a
 * filled shape at 20% opacity behind the outline. On the dark theme it looked
 * rich. **On the light theme it looked out of focus**, and that is not a matter
 * of taste: a 20%-opacity tint of `--subtle` (#8A8699) against `--field-soft`
 * (a 2% wash on near-white) is a few percent of contrast, so the fill layer
 * reads as a soft halo around the outline rather than as a second tone. Every
 * icon in the rail looked slightly blurred, and rendering the two themes side
 * by side made it obvious in a way that describing it does not.
 *
 * `bold` is the answer to both problems at once. It has the presence duotone
 * was reaching for, it is a single opaque path so it is crisp at 18px in either
 * theme, and it is *sharper* than duotone even on dark — the tint layer was
 * muddying the outline at this size rather than supporting it.
 *
 * Chrome icons stay `regular`. A chevron on a select or a close button is not
 * meant to have presence; it is meant to be invisible until wanted, and a bold
 * chevron is a chevron shouting.
 *
 * ── WHY THE `/ssr` ENTRY ──────────────────────────────────────────────
 *
 * Phosphor ships two builds. The default is a client component that reads an
 * `IconContext`, which would drag every icon in the app across the server
 * boundary and into the client bundle — on a dashboard that is almost entirely
 * server-rendered, that is a lot of JavaScript shipped in order to draw a
 * telephone. The `/ssr` build is a plain forwardRef with no context, so icons
 * render to markup on the server and cost the client nothing.
 *
 * It works inside client components too — `shell.tsx` uses these — it simply
 * does not inherit context, which nothing here relies on.
 */

import {
  /* Navigation */
  House, UserSound, Megaphone, Phone, ChartBar, Hash, CreditCard, Gear,
  Question, Buildings, Package,

  /* Actions */
  Plus, MagnifyingGlass, FunnelSimple, SlidersHorizontal, X, Check,
  CaretDown, CaretRight, CaretLeft, ArrowRight, ArrowUpRight, ArrowLeft,
  ArrowSquareOut, CopySimple, Trash, PencilSimple, ArrowsClockwise,
  DownloadSimple, Play, Pause, PaperPlaneTilt, DotsThree, List,

  /* State and feedback */
  Info, WarningCircle, Warning, CheckCircle, XCircle, CircleNotch, Circle,
  Prohibit, ShieldCheck, ShieldWarning, SealCheck, Eye, EyeSlash, Lock, Key,

  /* Movement */
  TrendUp, TrendDown, Minus, ArrowsDownUp, Equals,

  /* Time */
  Calendar, CalendarCheck, CalendarDots, Clock, Timer, Hourglass,

  /* People */
  Users, UserPlus, UserCheck, User, SignOut, Envelope, Bell,

  /* Telephony */
  PhoneOutgoing, PhoneIncoming, PhoneCall, PhoneX, Microphone, Broadcast,
  SpeakerHigh, CellSignalHigh,

  /* Records */
  Tag, FileText, ClipboardText, NotePencil, ChatCircle, Tray, LinkSimple,

  /* Money */
  Wallet, Receipt, Coins, CurrencyDollar, Percent,

  /* Charts */
  ChartPie, ChartLine, GridFour, Gauge,

  /* Flourish */
  Sparkle, Lightning, Rocket, Target, Star, ThumbsUp, Handshake, Briefcase,

  /* Trades */
  Wrench, Stethoscope, Hammer, Lifebuoy, Headset, MapPin, Globe,

  /* Theme */
  Sun, Moon, Monitor,
} from "@phosphor-icons/react/ssr"

import type { Icon as PhosphorIcon, IconWeight } from "@phosphor-icons/react"

export type IconProps = {
  size?: number | string
  weight?: IconWeight
  className?: string
  color?: string
  [key: string]: unknown
}

/**
 * What every icon in this file actually is.
 *
 * A plain function component, deliberately — anything taking one as a prop
 * should say `Icon`, not the library's own exported type. That distinction
 * exists because the previous version of this file typed a prop as the
 * library's `ForwardRefExoticComponent`, and passing a wrapped icon then failed
 * to compile with a message about a missing `$$typeof` that explains nothing.
 */
export type Icon = (props: IconProps) => React.JSX.Element

const SIZE = 18

/**
 * Wrap an icon in the house defaults, still overridable per use.
 *
 * `weight` is a default rather than a constant, so a call site that wants the
 * bold cut of a normally-duotone icon for one particular spot can say so.
 */
const glyph = (C: PhosphorIcon, display: string, weight: IconWeight = "bold"): Icon => {
  const Wrapped = (p: IconProps) => {
    const Component = C as unknown as React.ComponentType<Record<string, unknown>>
    return <Component size={SIZE} weight={weight} {...p} />
  }
  Wrapped.displayName = display
  return Wrapped
}

/** Chrome: a chevron with presence is a chevron in the way. */
const plain = (C: PhosphorIcon, display: string): Icon => glyph(C, display, "regular")

/* ── Navigation ────────────────────────────────────────────────────────── */

export const IconHome      = glyph(House,      "IconHome")
/**
 * A person, speaking.
 *
 * It was `Robot`, which is the AI cliché and reads as a toy at 18px — and it
 * described the implementation rather than the thing. What a tenant is buying
 * is somebody to answer the phone. `UserSound` says exactly that, and it stays
 * legible next to `Phone` for Calls and `Megaphone` for Campaigns, which a
 * microphone or a waveform would not.
 */
export const IconAgents    = glyph(UserSound,  "IconAgents")
export const IconCampaigns = glyph(Megaphone,  "IconCampaigns")
export const IconCalls     = glyph(Phone,      "IconCalls")
export const IconAnalytics = glyph(ChartBar,   "IconAnalytics")
export const IconNumbers   = glyph(Hash,       "IconNumbers")
export const IconBilling   = glyph(CreditCard, "IconBilling")
export const IconSettings  = glyph(Gear,       "IconSettings")
export const IconHelp      = glyph(Question,   "IconHelp")
export const IconTenants   = glyph(Buildings,  "IconTenants")
export const IconPackages  = glyph(Package,    "IconPackages")

/* ── Actions ───────────────────────────────────────────────────────────── */

export const IconPlus     = plain(Plus,              "IconPlus")
export const IconSearch   = plain(MagnifyingGlass,   "IconSearch")
export const IconFilter   = plain(FunnelSimple,      "IconFilter")
export const IconTune     = plain(SlidersHorizontal, "IconTune")
export const IconClose    = plain(X,                 "IconClose")
export const IconCheck    = plain(Check,             "IconCheck")
export const IconChevron  = plain(CaretDown,         "IconChevron")
export const IconNext     = plain(CaretRight,        "IconNext")
export const IconPrev     = plain(CaretLeft,         "IconPrev")
export const IconArrow    = plain(ArrowRight,        "IconArrow")
export const IconArrowOut = plain(ArrowUpRight,      "IconArrowOut")
export const IconBack     = plain(ArrowLeft,         "IconBack")
export const IconExternal = plain(ArrowSquareOut,    "IconExternal")
export const IconCopy     = plain(CopySimple,        "IconCopy")
export const IconDelete   = plain(Trash,             "IconDelete")
export const IconEdit     = plain(PencilSimple,      "IconEdit")
export const IconRefresh  = plain(ArrowsClockwise,   "IconRefresh")
export const IconDownload = plain(DownloadSimple,    "IconDownload")
export const IconPlay     = glyph(Play,              "IconPlay",  "fill")
export const IconPause    = glyph(Pause,             "IconPause", "fill")
export const IconSend     = plain(PaperPlaneTilt,    "IconSend")
export const IconMore     = plain(DotsThree,         "IconMore")
export const IconMenu     = plain(List,              "IconMenu")

/* ── State ─────────────────────────────────────────────────────────────── */

export const IconInfo     = glyph(Info,          "IconInfo")
export const IconAlert    = glyph(WarningCircle, "IconAlert")
export const IconWarning  = glyph(Warning,       "IconWarning")
export const IconSuccess  = glyph(CheckCircle,   "IconSuccess")
export const IconFailure  = glyph(XCircle,       "IconFailure")
/** Regular, not duotone: a spinner's whole job is one clear rotating arc. */
export const IconSpinner  = plain(CircleNotch,   "IconSpinner")
export const IconLive     = glyph(Circle,        "IconLive", "fill")
export const IconBlocked  = glyph(Prohibit,      "IconBlocked")
export const IconSecure   = glyph(ShieldCheck,   "IconSecure")
export const IconRisk     = glyph(ShieldWarning, "IconRisk")
export const IconVerified = glyph(SealCheck,     "IconVerified")
export const IconShow     = plain(Eye,           "IconShow")
export const IconHide     = plain(EyeSlash,      "IconHide")
export const IconLock     = glyph(Lock,          "IconLock")
export const IconKey      = glyph(Key,           "IconKey")

/* ── Movement ──────────────────────────────────────────────────────────── */

export const IconUp    = glyph(TrendUp,      "IconUp",   "bold")
export const IconDown  = glyph(TrendDown,    "IconDown", "bold")
export const IconFlat  = plain(Minus,        "IconFlat")
export const IconSort  = plain(ArrowsDownUp, "IconSort")
export const IconEqual = plain(Equals,       "IconEqual")

/* ── Time ──────────────────────────────────────────────────────────────── */

export const IconCalendar  = glyph(Calendar,      "IconCalendar")
export const IconBooked    = glyph(CalendarCheck, "IconBooked")
export const IconScheduled = glyph(CalendarDots,  "IconScheduled")
export const IconDays      = glyph(CalendarDots,  "IconDays")
export const IconClock     = glyph(Clock,         "IconClock")
export const IconDuration  = glyph(Timer,         "IconDuration")
export const IconWaiting   = glyph(Hourglass,     "IconWaiting")

/* ── People ────────────────────────────────────────────────────────────── */

export const IconPeople  = glyph(Users,     "IconPeople")
export const IconInvite  = glyph(UserPlus,  "IconInvite")
export const IconMember  = glyph(UserCheck, "IconMember")
export const IconPerson  = glyph(User,      "IconPerson")
export const IconSignOut = plain(SignOut,   "IconSignOut")
export const IconMail    = glyph(Envelope,  "IconMail")
export const IconBell    = glyph(Bell,      "IconBell")

/* ── Telephony ─────────────────────────────────────────────────────────── */

export const IconOutbound  = glyph(PhoneOutgoing,  "IconOutbound")
export const IconInbound   = glyph(PhoneIncoming,  "IconInbound")
export const IconConnected = glyph(PhoneCall,      "IconConnected")
export const IconMissed    = glyph(PhoneX,         "IconMissed")
export const IconHungUp    = glyph(PhoneX,         "IconHungUp")
export const IconMic       = glyph(Microphone,     "IconMic")
export const IconVoicemail = glyph(Broadcast,      "IconVoicemail")
export const IconRecording = glyph(SpeakerHigh,    "IconRecording")
export const IconSignal    = glyph(CellSignalHigh, "IconSignal")

/* ── Records ───────────────────────────────────────────────────────────── */

export const IconTag        = glyph(Tag,           "IconTag")
export const IconTranscript = glyph(FileText,      "IconTranscript")
export const IconChecklist  = glyph(ClipboardText, "IconChecklist")
export const IconNote       = glyph(NotePencil,    "IconNote")
export const IconSummary    = glyph(ChatCircle,    "IconSummary")
export const IconInbox      = glyph(Tray,          "IconInbox")
export const IconLink       = plain(LinkSimple,    "IconLink")

/* ── Money ─────────────────────────────────────────────────────────────── */

export const IconBalance = glyph(Wallet,         "IconBalance")
export const IconInvoice = glyph(Receipt,        "IconInvoice")
export const IconCredits = glyph(Coins,          "IconCredits")
export const IconCost    = glyph(CurrencyDollar, "IconCost")
export const IconRate    = glyph(Percent,        "IconRate", "bold")

/* ── Charts ────────────────────────────────────────────────────────────── */

export const IconShare = glyph(ChartPie,  "IconShare")
export const IconTrend = glyph(ChartLine, "IconTrend")
export const IconHeat  = glyph(GridFour,  "IconHeat")
export const IconGauge = glyph(Gauge,     "IconGauge")

/* ── Flourish ──────────────────────────────────────────────────────────── */

export const IconMagic    = glyph(Sparkle,   "IconMagic", "fill")
export const IconFast     = glyph(Lightning, "IconFast")
export const IconLaunch   = glyph(Rocket,    "IconLaunch")
export const IconTarget   = glyph(Target,    "IconTarget")
export const IconStar     = glyph(Star,      "IconStar")
export const IconApproved = glyph(ThumbsUp,  "IconApproved")
export const IconDeal     = glyph(Handshake, "IconDeal")
export const IconWork     = glyph(Briefcase, "IconWork")

/* ── Trades ────────────────────────────────────────────────────────────── */

export const IconTrade     = glyph(Wrench,      "IconTrade")
export const IconClinic    = glyph(Stethoscope, "IconClinic")
export const IconBuild     = glyph(Hammer,      "IconBuild")
export const IconSupport   = glyph(Lifebuoy,    "IconSupport")
export const IconFrontDesk = glyph(Headset,     "IconFrontDesk")
export const IconLocation  = glyph(MapPin,      "IconLocation")
export const IconWorld     = glyph(Globe,       "IconWorld")

/* ── Theme ─────────────────────────────────────────────────────────────── */

export const IconLight  = glyph(Sun,     "IconLight")
export const IconDark   = glyph(Moon,    "IconDark")
export const IconSystem = glyph(Monitor, "IconSystem")

/* ── By meaning ────────────────────────────────────────────────────────── */

/**
 * Marketing and campaigns are the same picture, and both names get used.
 *
 * Declared before `JOB_ICON` rather than after it because `JOB_ICON` is built
 * when this module loads: a `const` referenced above its declaration is a
 * ReferenceError at import time, not a lint warning, and it would take the
 * whole dashboard down.
 */
export const IconMegaphone = IconCampaigns

/**
 * The icon for a template's job, and for a trade.
 *
 * Kept here rather than in `templates.ts` on purpose: that file is imported by
 * server code and must stay data-only, and a JSX import would drag React into
 * it. This is the boundary.
 */
export const JOB_ICON = {
  "front-desk": IconFrontDesk,
  sales:        IconDeal,
  booking:      IconBooked,
  support:      IconSupport,
  marketing:    IconMegaphone,
  ops:          IconWork,
  custom:       IconMagic,
} as const

export const INDUSTRY_ICON = {
  "home-services": IconBuild,
  hvac:            IconTrade,
  clinic:          IconClinic,
  property:        IconTenants,
} as const

export const DIRECTION_ICON = {
  inbound:  IconInbound,
  outbound: IconOutbound,
  both:     IconConnected,
} as const
