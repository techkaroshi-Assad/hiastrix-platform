/**
 * Moved.
 *
 * The form is shared with the edit page now, so it lives one level up at
 * `campaigns/campaign-form.tsx`. Two copies would have drifted, and a rule
 * explained when a campaign is created would quietly stop being explained when
 * it is changed.
 *
 * Kept as a re-export so nothing that still points here breaks. Safe to delete
 * once you've confirmed nothing imports it:
 *
 *   git rm "src/app/dashboard/campaigns/new/new-campaign-form.tsx"
 */

export { CampaignForm as NewCampaignForm, type AgentOption } from "../campaign-form"
