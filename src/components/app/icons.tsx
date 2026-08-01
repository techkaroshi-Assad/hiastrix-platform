/**
 * The icon vocabulary.
 *
 * ── WHY THIS FILE CHANGED ─────────────────────────────────────────────
 *
 * There used to be eleven hand-drawn icons here and twenty-nine more scattered
 * as loose `<svg>` literals across form controls, the theme toggle and one
 * table cell. That is not a design system, it is a habit — and it had two
 * costs. Adding an icon meant drawing one, so most things never got one: page
 * headers, stat cards, buttons, tabs, status pills and every row of every table
 * were text only. And the ones that did exist drifted, because a stroke width
 * typed by hand in six files is a stroke width that is wrong in one of them.
 *
 * So the drawing is now Lucide's job. It is stroke-based on a 24px grid with
 * round caps and joins — which is exactly what the hand-drawn set was imitating
 * — so nothing about the look changes, there is just far more of it and it is
 * consistent.
 *
 * ── WHY THIS FILE STILL EXISTS ────────────────────────────────────────
 *
 * Importing straight from `lucide-react` everywhere would work and would be
 * worse. Three reasons to go through here:
 *
 * 1. **The names are ours.** `IconCampaigns` survives a decision to draw
 *    campaigns as a megaphone instead of a handset. `PhoneOutgoing` does not.
 *    Screens import meaning, not pictures.
 * 2. **The size and weight are decided once.** Every icon in the product is
 *    18px at 1.7 stroke unless it says otherwise, and that is enforced here
 *    rather than remembered in ninety call sites.
 * 3. **White-labelling.** The brand mark is still ours and still hand-drawn in
 *    `brand/logo.tsx`. When a tenant's own icon set eventually matters, this is
 *    the one file that changes.
 *
 * Exports are named rather than bundled into an object, so the bundler only
 * ships the icons a page actually renders.
 *
 * ── ON VERSIONS ───────────────────────────────────────────────────────
 *
 * Lucide has renamed a number of icons over the years and keeps the old names
 * as aliases. Everything below is verified present in the installed version;
 * if an upgrade ever removes an alias, it breaks here, loudly, in one file,
 * rather than in whichever screen happened to import it.
 */

import {
  /* Navigation */
  Home, Bot, Megaphone, Phone, BarChart3, Hash, CreditCard, Settings,
  HelpCircle, Building2, Package,

  /* Actions */
  Plus, Search, Filter, SlidersHorizontal, X, Check, ChevronDown, ChevronRight,
  ChevronLeft, ArrowRight, ArrowUpRight, ArrowLeft, ExternalLink, Copy, Trash2,
  Pencil, RefreshCw, Download, Play, Pause, Send, MoreHorizontal, Menu,

  /* State and feedback */
  Info, AlertCircle, AlertTriangle, CheckCircle2, XCircle, Loader2, CircleDot, Ban,
  ShieldCheck, ShieldAlert, BadgeCheck, Eye, EyeOff, Lock, KeyRound,

  /* Movement */
  TrendingUp, TrendingDown, Minus, ArrowUpDown, Equal,

  /* Time */
  Calendar, CalendarCheck, CalendarClock, CalendarDays, Clock, Timer, Hourglass,

  /* People */
  Users, UserPlus, UserCheck, User, LogOut, Mail, Bell,

  /* Telephony */
  PhoneOutgoing, PhoneIncoming, PhoneCall, PhoneMissed, PhoneOff, Mic, Voicemail,
  Volume2, Signal,

  /* Records */
  Tag, FileText, ClipboardList, NotebookPen, MessageSquare, Inbox, Link2,

  /* Money */
  Wallet, Receipt, Coins, DollarSign, Percent,

  /* Charts */
  PieChart, LineChart, Grid3x3, Gauge,

  /* Flourish */
  Sparkles, Zap, Rocket, Target, Star, ThumbsUp, Handshake, Briefcase,

  /* Trades, for the industry template variants */
  Wrench, Stethoscope, Hammer, LifeBuoy, Headphones, MapPin, Globe,

  /* Theme */
  Sun, Moon, Monitor,

  type LucideIcon,
} from "lucide-react"

export type { LucideIcon }

/**
 * The house size.
 *
 * 18px at 1.7 is what the hand-drawn set used, and matching it means nothing
 * shifted visually when this file was rewritten. Anything that wants a
 * different size passes `size` — every export below forwards its props.
 */
const NAV_SIZE = 18
const NAV_STROKE = 1.7

export type IconProps = React.ComponentProps<LucideIcon>

/**
 * What every icon in this file actually is.
 *
 * *Not* `LucideIcon`. That type is a `ForwardRefExoticComponent`, and the
 * wrapper below is a plain function component — so typing a prop as
 * `icon?: LucideIcon` and passing `IconInbound` fails to compile with a
 * genuinely baffling message about a missing `$$typeof`. Anything that takes
 * one of these as a prop should say `Icon`.
 */
export type Icon = (props: IconProps) => React.JSX.Element

/** Wrap a Lucide icon in the house defaults, still overridable per use. */
const glyph = (C: LucideIcon, display: string): Icon => {
  const Wrapped = (p: IconProps) => <C size={NAV_SIZE} strokeWidth={NAV_STROKE} {...p} />
  Wrapped.displayName = display
  return Wrapped
}

/* ── Navigation ────────────────────────────────────────────────────────── */

export const IconHome      = glyph(Home,       "IconHome")
export const IconAgents    = glyph(Bot,        "IconAgents")
export const IconCampaigns = glyph(Megaphone,  "IconCampaigns")
export const IconCalls     = glyph(Phone,      "IconCalls")
export const IconAnalytics = glyph(BarChart3,  "IconAnalytics")
export const IconNumbers   = glyph(Hash,       "IconNumbers")
export const IconBilling   = glyph(CreditCard, "IconBilling")
export const IconSettings  = glyph(Settings,   "IconSettings")
export const IconHelp      = glyph(HelpCircle, "IconHelp")
export const IconTenants   = glyph(Building2,  "IconTenants")
export const IconPackages  = glyph(Package,    "IconPackages")

/* ── Actions ───────────────────────────────────────────────────────────── */

export const IconPlus     = glyph(Plus,            "IconPlus")
export const IconSearch   = glyph(Search,          "IconSearch")
export const IconFilter   = glyph(Filter,          "IconFilter")
export const IconTune     = glyph(SlidersHorizontal, "IconTune")
export const IconClose    = glyph(X,               "IconClose")
export const IconCheck    = glyph(Check,           "IconCheck")
export const IconChevron  = glyph(ChevronDown,     "IconChevron")
export const IconNext     = glyph(ChevronRight,    "IconNext")
export const IconPrev     = glyph(ChevronLeft,     "IconPrev")
export const IconArrow    = glyph(ArrowRight,      "IconArrow")
export const IconArrowOut = glyph(ArrowUpRight,    "IconArrowOut")
export const IconBack     = glyph(ArrowLeft,       "IconBack")
export const IconExternal = glyph(ExternalLink,    "IconExternal")
export const IconCopy     = glyph(Copy,            "IconCopy")
export const IconDelete   = glyph(Trash2,          "IconDelete")
export const IconEdit     = glyph(Pencil,          "IconEdit")
export const IconRefresh  = glyph(RefreshCw,       "IconRefresh")
export const IconDownload = glyph(Download,        "IconDownload")
export const IconPlay     = glyph(Play,            "IconPlay")
export const IconPause    = glyph(Pause,           "IconPause")
export const IconSend     = glyph(Send,            "IconSend")
export const IconMore     = glyph(MoreHorizontal,  "IconMore")
export const IconMenu     = glyph(Menu,            "IconMenu")

/* ── State ─────────────────────────────────────────────────────────────── */

export const IconInfo     = glyph(Info,          "IconInfo")
export const IconAlert    = glyph(AlertCircle,   "IconAlert")
export const IconWarning  = glyph(AlertTriangle, "IconWarning")
export const IconSuccess  = glyph(CheckCircle2,  "IconSuccess")
export const IconFailure  = glyph(XCircle,       "IconFailure")
export const IconSpinner  = glyph(Loader2,       "IconSpinner")
export const IconLive     = glyph(CircleDot,     "IconLive")
export const IconBlocked  = glyph(Ban,           "IconBlocked")
export const IconSecure   = glyph(ShieldCheck,   "IconSecure")
export const IconRisk     = glyph(ShieldAlert,   "IconRisk")
export const IconVerified = glyph(BadgeCheck,    "IconVerified")
export const IconShow     = glyph(Eye,           "IconShow")
export const IconHide     = glyph(EyeOff,        "IconHide")
export const IconLock     = glyph(Lock,          "IconLock")
export const IconKey      = glyph(KeyRound,      "IconKey")

/* ── Movement ──────────────────────────────────────────────────────────── */

export const IconUp    = glyph(TrendingUp,   "IconUp")
export const IconDown  = glyph(TrendingDown, "IconDown")
export const IconFlat  = glyph(Minus,        "IconFlat")
export const IconSort  = glyph(ArrowUpDown,  "IconSort")
export const IconEqual = glyph(Equal,        "IconEqual")

/* ── Time ──────────────────────────────────────────────────────────────── */

export const IconCalendar  = glyph(Calendar,      "IconCalendar")
export const IconBooked    = glyph(CalendarCheck, "IconBooked")
export const IconScheduled = glyph(CalendarClock, "IconScheduled")
export const IconDays      = glyph(CalendarDays,  "IconDays")
export const IconClock     = glyph(Clock,         "IconClock")
export const IconDuration  = glyph(Timer,         "IconDuration")
export const IconWaiting   = glyph(Hourglass,     "IconWaiting")

/* ── People ────────────────────────────────────────────────────────────── */

export const IconPeople  = glyph(Users,     "IconPeople")
export const IconInvite  = glyph(UserPlus,  "IconInvite")
export const IconMember  = glyph(UserCheck, "IconMember")
export const IconPerson  = glyph(User,      "IconPerson")
export const IconSignOut = glyph(LogOut,    "IconSignOut")
export const IconMail    = glyph(Mail,      "IconMail")
export const IconBell    = glyph(Bell,      "IconBell")

/* ── Telephony ─────────────────────────────────────────────────────────── */

export const IconOutbound  = glyph(PhoneOutgoing, "IconOutbound")
export const IconInbound   = glyph(PhoneIncoming, "IconInbound")
export const IconConnected = glyph(PhoneCall,     "IconConnected")
export const IconMissed    = glyph(PhoneMissed,   "IconMissed")
export const IconHungUp    = glyph(PhoneOff,      "IconHungUp")
export const IconMic       = glyph(Mic,           "IconMic")
export const IconVoicemail = glyph(Voicemail,     "IconVoicemail")
export const IconRecording = glyph(Volume2,       "IconRecording")
export const IconSignal    = glyph(Signal,        "IconSignal")

/* ── Records ───────────────────────────────────────────────────────────── */

export const IconTag        = glyph(Tag,           "IconTag")
export const IconTranscript = glyph(FileText,      "IconTranscript")
export const IconChecklist  = glyph(ClipboardList, "IconChecklist")
export const IconNote       = glyph(NotebookPen,   "IconNote")
export const IconSummary    = glyph(MessageSquare, "IconSummary")
export const IconInbox      = glyph(Inbox,         "IconInbox")
export const IconLink       = glyph(Link2,         "IconLink")

/* ── Money ─────────────────────────────────────────────────────────────── */

export const IconBalance = glyph(Wallet,     "IconBalance")
export const IconInvoice = glyph(Receipt,    "IconInvoice")
export const IconCredits = glyph(Coins,      "IconCredits")
export const IconCost    = glyph(DollarSign, "IconCost")
export const IconRate    = glyph(Percent,    "IconRate")

/* ── Charts ────────────────────────────────────────────────────────────── */

export const IconShare  = glyph(PieChart,  "IconShare")
export const IconTrend  = glyph(LineChart, "IconTrend")
export const IconHeat   = glyph(Grid3x3,   "IconHeat")
export const IconGauge  = glyph(Gauge,     "IconGauge")

/* ── Flourish ──────────────────────────────────────────────────────────── */

export const IconMagic    = glyph(Sparkles,  "IconMagic")
export const IconFast     = glyph(Zap,       "IconFast")
export const IconLaunch   = glyph(Rocket,    "IconLaunch")
export const IconTarget   = glyph(Target,    "IconTarget")
export const IconStar     = glyph(Star,      "IconStar")
export const IconApproved = glyph(ThumbsUp,  "IconApproved")
export const IconDeal     = glyph(Handshake, "IconDeal")
export const IconWork     = glyph(Briefcase, "IconWork")

/* ── Trades ────────────────────────────────────────────────────────────── */

export const IconTrade      = glyph(Wrench,      "IconTrade")
export const IconClinic     = glyph(Stethoscope, "IconClinic")
export const IconBuild      = glyph(Hammer,      "IconBuild")
export const IconSupport    = glyph(LifeBuoy,    "IconSupport")
export const IconFrontDesk  = glyph(Headphones,  "IconFrontDesk")
export const IconLocation   = glyph(MapPin,      "IconLocation")
export const IconWorld      = glyph(Globe,       "IconWorld")

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
