// Step 2, Campaign Setup.
//
// Outreach 2.0 has a single campaign type, so setup is down to one field:
// the campaign name. Continue is gated on a non-empty name (see canAdvance
// in NewOutreachWizard). `clientId` stays in wizard state as an optional
// association with no UI on this step. The previous direction-branched
// StepSetup lived inline in NewOutreachWizard.tsx and was removed with the
// campaign-type fork (git history has it).

import { Input } from 'antd';

interface Props {
  campaignName: string;
  onName: (name: string) => void;
}

export function StepCampaignSetup({ campaignName, onName }: Props) {
  return (
    <div>
      <h2>Name your campaign</h2>
      <div className="ov2-pane-sub">
        A working name for this outreach — it appears in your drafts and reports, never to
        recipients.
      </div>
      <label
        htmlFor="ov2-campaign-name"
        style={{ display: 'block', fontWeight: 600, fontSize: 13, marginBottom: 6 }}
      >
        Campaign name
      </label>
      <Input
        id="ov2-campaign-name"
        autoFocus
        value={campaignName}
        onChange={(e) => onName(e.target.value)}
        placeholder="e.g. FY27 NDAA, Section 218 push"
        style={{ width: '100%' }}
      />
    </div>
  );
}
