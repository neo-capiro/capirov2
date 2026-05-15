import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.workflowTemplate.upsert({
    where: { slug: 'ndaa-authorization-request' },
    update: {},
    create: {
      slug: 'ndaa-authorization-request',
      name: 'NDAA Authorization Request',
      description:
        'A written request to a Member of Congress asking them to submit a program authorization increase to HASC or SASC for inclusion in the NDAA markup. Also called a program plus-up. Almost always submitted alongside an Appropriations Request.',
      category: 'authorization',
      sortOrder: 1,
      requiredSections: [
        {
          key: 'pe_number',
          type: 'text',
          required: true,
          section: 'program_info',
          label: 'PE Number',
          description: 'The PE number for the defense program',
        },
        {
          key: 'appropriation_account',
          type: 'text',
          required: true,
          section: 'program_info',
          label: 'Appropriation Account',
          description: 'The appropriation account (e.g., RDT&E, Procurement)',
        },
        {
          key: 'budget_activity',
          type: 'text',
          required: true,
          section: 'program_info',
          label: 'Budget Activity',
          description: 'The budget activity number',
        },
        {
          key: 'line_item_number',
          type: 'text',
          required: true,
          section: 'program_info',
          label: 'Line Item Number',
          description: 'The specific line item number',
        },
        {
          key: 'current_pbr_funding',
          type: 'currency',
          required: true,
          section: 'funding',
          label: 'Current PBR Funding',
          description: "Current funding level in the President's Budget Request for this PE/line",
        },
        {
          key: 'requested_authorization',
          type: 'currency',
          required: true,
          section: 'funding',
          label: 'Requested Authorization',
          description: 'The dollar amount you are requesting Congress to authorize',
        },
        {
          key: 'delta_above_pbr',
          type: 'currency',
          required: false,
          section: 'funding',
          label: 'Delta Above PBR',
          description: 'Auto-calculated: Requested Authorization minus Current PBR',
          computed: true,
        },
        {
          key: 'program_description',
          type: 'textarea',
          required: true,
          section: 'description',
          label: 'Program Description',
          description:
            "What the program does, its current status, and operational relevance",
        },
      ],
      contextInfo: {
        overview:
          'An NDAA Authorization Request is a formal written request submitted to a Member of Congress asking them to sponsor a program authorization increase in the National Defense Authorization Act. The request asks the member to include a specific dollar amount above the President\'s Budget Request (PBR) for a given defense program in their markup of the NDAA, either through the House Armed Services Committee (HASC) or Senate Armed Services Committee (SASC).',
        timing:
          'The submission window typically opens in January after the release of the President\'s Budget Request (first Monday in February). House deadlines are typically late February to mid-March; Senate deadlines are typically in March. Some offices accept requests as early as the third week of January. Timing varies significantly by office — always confirm with the specific member\'s staff.',
        submission:
          'Requests are submitted to the member\'s personal office — specifically to the defense Legislative Assistant (LA) or military LA. Do NOT submit directly to HASC or SASC staff. Common submission methods include office portals, email PDF, and in-person delivery. Most offices require a 1-2 page white paper format, though specific format requirements vary by office.',
        why:
          'The NDAA is the primary legislative vehicle for establishing new defense program authority and increasing authorized funding ceilings above the President\'s Budget Request. Authorization alone does not provide funding — it sets the ceiling. A successful NDAA authorization request is often a prerequisite for a subsequent appropriations request.',
        companion:
          'Almost always submitted alongside Template 2.1 (Appropriations Request)',
      },
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
