import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const requiredSections = {
  requestTypes: ['funding', 'policy'],
  sections: {
    funding: {
      section1: {
        title: 'Funding Request',
        fields: [
          { key: 'title_of_request', label: 'Title of Request', type: 'text', maxLength: 100, required: true },
          { key: 'appropriations_account', label: 'Appropriations Account', type: 'text', maxLength: 100, required: true },
          { key: 'subcommittee', label: 'Subcommittee', type: 'select', required: true, options: ['Airland', 'Cybersecurity', 'Emerging Threats and Capabilities', 'Personnel', 'Readiness and Management Support', 'Seapower', 'Strategic Forces'] },
          { key: 'program', label: 'Program', type: 'text', maxLength: 100, required: true },
          { key: 'program_element', label: 'Program Element (PE)', type: 'text', maxLength: 100, required: true, helpText: 'Please provide the most specific information you can.' },
          { key: 'line_number', label: 'Line Number', type: 'text', maxLength: 100, required: true },
          { key: 'requested_funding_amount', label: 'Your FY2026 Requested Funding Amount', type: 'integer', required: true, helpText: 'Please provide a specific dollar amount. No decimals or symbols.' },
          { key: 'president_budget_amount', label: "President's FY2026 Budget Requested Funding Amount", type: 'integer', required: true, helpText: "If the President's Budget is not yet released, please type 35. An email will be sent later allowing you to update." },
          { key: 'enacted_funding_amount', label: 'FY2025 Enacted Appropriations Bill Funding Amount', type: 'integer', required: true, helpText: 'No decimals or symbols.' },
          { key: 'justification', label: 'Brief explanation justifying the request', type: 'textarea', required: true },
          { key: 'proposed_language', label: 'Proposed report or bill language', type: 'textarea', required: false, helpText: 'If applicable, please provide the proposed report or bill language to accompany the funding request.' },
          { key: 'proposed_language_type', label: 'Language type', type: 'select', required: false, options: ['Report', 'Bill'], helpText: 'Please indicate if the provided language is for a report or bill.' },
          { key: 'num_funding_requests', label: 'How many funding requests is your organization submitting?', type: 'integer', required: true },
          { key: 'priority_rank', label: 'Priority Rank of Proposal', type: 'integer', required: true, helpText: 'If only one proposal is being submitted, please enter 1.' },
          { key: 'connection_to_massachusetts', label: 'Does this request have a connection to Massachusetts?', type: 'boolean', required: true },
          { key: 'massachusetts_connection_detail', label: 'What is the connection to Massachusetts?', type: 'textarea', required: false, conditional: { field: 'connection_to_massachusetts', value: true } },
          { key: 'submitted_other_offices', label: 'Have you submitted this request to other offices?', type: 'boolean', required: true },
          { key: 'other_offices_detail', label: 'If yes, please list which other offices.', type: 'textarea', required: false, conditional: { field: 'submitted_other_offices', value: true } },
        ],
      },
    },
    policy: {
      section1: {
        title: 'Bill/Report Language Request',
        fields: [
          { key: 'title_of_request', label: 'Title of Request', type: 'text', maxLength: 100, required: true },
          { key: 'language_purpose', label: 'What is the purpose of the language request?', type: 'select', required: true, options: ['Bill Language', 'Report Language', 'Bill and Report Language'] },
          { key: 'subcommittee', label: 'Subcommittee', type: 'select', required: true, options: ['Airland', 'Cybersecurity', 'Emerging Threats and Capabilities', 'Personnel', 'Readiness and Management Support', 'Seapower', 'Strategic Forces'] },
          { key: 'program', label: 'Program', type: 'text', maxLength: 100, required: true },
          { key: 'program_element', label: 'Program Element (PE)', type: 'text', maxLength: 100, required: true },
          { key: 'line_number', label: 'Line Number', type: 'text', maxLength: 100, required: true },
          { key: 'proposed_bill_language', label: 'Proposed Bill Language', type: 'textarea', required: false },
          { key: 'proposed_report_language', label: 'Proposed Report Language', type: 'textarea', required: false, helpText: 'For examples of report language, please see FY25 NDAA Senate Report 118-188.' },
          { key: 'justification', label: 'Brief explanation justifying the request', type: 'textarea', required: true },
          { key: 'num_language_requests', label: 'How many language requests is your organization submitting?', type: 'integer', required: true },
          { key: 'priority_rank', label: 'Priority Rank of Proposal', type: 'integer', required: true, helpText: 'If only one proposal is being submitted, please enter 1.' },
          { key: 'connection_to_massachusetts', label: 'Does this request have a connection to Massachusetts?', type: 'boolean', required: true },
          { key: 'massachusetts_connection_detail', label: 'What is the connection to Massachusetts?', type: 'textarea', required: false, conditional: { field: 'connection_to_massachusetts', value: true } },
          { key: 'submitted_other_offices', label: 'Have you submitted this request to other offices?', type: 'boolean', required: true },
          { key: 'other_offices_detail', label: 'If yes, please list which other offices.', type: 'textarea', required: false, conditional: { field: 'submitted_other_offices', value: true } },
        ],
      },
    },
    shared: {
      requesterContact: {
        title: 'Your Contact Information',
        helpText: 'Pre-populated from your organization settings. Update in Settings if needed.',
        fields: [
          { key: 'requester_name', label: 'Name', type: 'text', required: true, source: 'tenant_settings' },
          { key: 'requester_phone', label: 'Phone', type: 'text', required: true, source: 'tenant_settings' },
          { key: 'requester_email', label: 'Email', type: 'text', required: true, source: 'tenant_settings' },
          { key: 'requester_mailing_street1', label: 'Mailing Address - Street 1', type: 'text', source: 'tenant_settings' },
          { key: 'requester_mailing_street2', label: 'Mailing Address - Street 2', type: 'text', source: 'tenant_settings' },
          { key: 'requester_mailing_city', label: 'City', type: 'text', source: 'tenant_settings' },
          { key: 'requester_mailing_state_zip', label: 'State/Zip', type: 'text', source: 'tenant_settings' },
          { key: 'requester_permanent_street1', label: 'Permanent Address - Street 1', type: 'text', source: 'tenant_settings' },
          { key: 'requester_permanent_street2', label: 'Permanent Address - Street 2', type: 'text', source: 'tenant_settings' },
          { key: 'requester_permanent_city', label: 'City', type: 'text', source: 'tenant_settings' },
          { key: 'requester_permanent_state_zip', label: 'State/Zip', type: 'text', source: 'tenant_settings' },
        ],
      },
      orgContact: {
        title: 'Organization/Entity Contact Information',
        helpText: 'Select a client to pre-populate.',
        fields: [
          { key: 'org_name', label: 'Name of the Organization/Entity', type: 'text', maxLength: 100, required: true, source: 'client' },
          { key: 'org_head_name', label: 'Name of Head of the Organization/Entity', type: 'text', maxLength: 100, required: true },
          { key: 'org_head_title', label: 'Title of Head of the Organization/Entity', type: 'text', maxLength: 100, required: true },
          { key: 'org_address1', label: 'Address Line 1', type: 'text', maxLength: 100, source: 'client' },
          { key: 'org_address2', label: 'Address Line 2', type: 'text', maxLength: 100, source: 'client' },
          { key: 'org_city', label: 'City', type: 'text', maxLength: 100, source: 'client' },
          { key: 'org_state', label: 'State/Territories/Armed Forces', type: 'select', options: ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC', 'PR', 'VI', 'GU', 'AS', 'MP', 'AA', 'AE', 'AP'], source: 'client' },
          { key: 'org_zip', label: 'ZIP Code', type: 'text', helpText: '##### or #####-####', source: 'client' },
          { key: 'org_phone', label: 'Phone Number', type: 'text', helpText: '###-###-####', source: 'client' },
          { key: 'poc_name', label: 'Primary POC - Name', type: 'text', maxLength: 100, required: true, source: 'client' },
          { key: 'poc_title', label: 'Primary POC - Title', type: 'text', maxLength: 100 },
          { key: 'poc_phone', label: 'Primary POC - Phone', type: 'text', helpText: '###-###-####', source: 'client' },
          { key: 'poc_email', label: 'Primary POC - Email', type: 'text', helpText: 'i.e. your-email@mail.com', source: 'client' },
          { key: 'dod_contact', label: 'Department of Defense Contact for Request', type: 'text', maxLength: 100 },
        ],
      },
    },
  },
};

const contextInfo = {
  overview:
    "An NDAA Authorization Request is a formal written request submitted to a Member of Congress asking them to sponsor a program authorization increase in the National Defense Authorization Act. The request asks the member to include a specific dollar amount above the President's Budget Request (PBR) for a given defense program in their markup of the NDAA, either through the House Armed Services Committee (HASC) or Senate Armed Services Committee (SASC).",
  timing:
    "The submission window typically opens in January after the release of the President's Budget Request (first Monday in February). House deadlines are typically late February to mid-March; Senate deadlines are typically in March. Some offices accept requests as early as the third week of January. Timing varies significantly by office — always confirm with the specific member's staff.",
  submission:
    "Requests are submitted to the member's personal office — specifically to the defense Legislative Assistant (LA) or military LA. Do NOT submit directly to HASC or SASC staff. Common submission methods include office portals, email PDF, and in-person delivery. Most offices require a 1-2 page white paper format, though specific format requirements vary by office.",
  why: "The NDAA is the primary legislative vehicle for establishing new defense program authority and increasing authorized funding ceilings above the President's Budget Request. Authorization alone does not provide funding — it sets the ceiling. A successful NDAA authorization request is often a prerequisite for a subsequent appropriations request.",
  companion: 'Almost always submitted alongside Template 2.1 (Appropriations Request)',
};

async function main() {
  await prisma.workflowTemplate.upsert({
    where: { slug: 'ndaa-authorization-request' },
    update: {
      requiredSections,
    },
    create: {
      slug: 'ndaa-authorization-request',
      name: 'NDAA Authorization Request',
      description:
        'A written request to a Member of Congress asking them to submit a program authorization increase to HASC or SASC for inclusion in the NDAA markup. Also called a program plus-up. Almost always submitted alongside an Appropriations Request.',
      category: 'authorization',
      sortOrder: 1,
      requiredSections,
      contextInfo,
    },
  });

  console.log('Seeded NDAA Authorization Request workflow template.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
