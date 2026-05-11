/**
 * Provision the internal `capiro-internal` tenant and invite a Capiro staff
 * member as `capiro_admin`. Run once per Capiro staff member you want to
 * onboard.
 *
 *   pnpm --filter @capiro/api bootstrap:capiro-admin -- \
 *     --email neo@capiro.ai \
 *     [--name "Neo Martinez"]
 *
 * What this does:
 *   1. Ensure the Clerk org `capiro-internal` exists (creates if not).
 *   2. Ensure the matching `tenants` row exists with role markers.
 *   3. Send a Clerk org invitation to the email with role `admin`.
 *   4. The webhook handler picks up the membership-created event and inserts
 *      a `tenant_memberships` row with role `capiro_admin` (NOT `user_admin`)
 *      because the membership belongs to the capiro-internal tenant.
 *
 * The `capiro_admin` role is granted by the webhook handler when the org slug
 * matches the reserved `capiro-internal` slug. See clerk-webhook.service.ts.
 */
import { config as dotenvConfig } from 'dotenv';
import { createClerkClient } from '@clerk/backend';
import { PrismaClient } from '@prisma/client';

dotenvConfig();

const CAPIRO_INTERNAL_SLUG = 'capiro-internal';
const CAPIRO_INTERNAL_NAME = 'Capiro Internal';

interface Args {
  email: string;
  name?: string;
  resend?: boolean;
  // Skip the invitation flow. Directly add the user to the Clerk org as
  // org:admin and insert the matching tenant_membership row in the DB.
  // Used to bootstrap a staging environment where the Clerk webhook isn't
  // wired up (so accepted invitations never produce a membership row).
  // Requires the user to already exist in Clerk under the configured
  // CLERK_SECRET_KEY instance.
  forceAdd?: boolean;
}

function parseArgs(): Args {
  const args: Partial<Args> = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    switch (k) {
      case '--email':
        args.email = v?.trim().toLowerCase();
        i++;
        break;
      case '--name':
        args.name = v;
        i++;
        break;
      case '--resend':
        args.resend = true;
        break;
      case '--force-add':
        args.forceAdd = true;
        break;
    }
  }
  if (!args.email) throw new Error('Missing --email');
  return args as Args;
}

async function main() {
  const args = parseArgs();
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error('CLERK_SECRET_KEY is not set');
  const clerk = createClerkClient({ secretKey });

  // Step 1 - Clerk org
  const orgList = await clerk.organizations.getOrganizationList({
    query: CAPIRO_INTERNAL_SLUG,
    limit: 10,
  });
  let org = orgList.data.find((o) => o.slug === CAPIRO_INTERNAL_SLUG);
  if (!org) {
    org = await clerk.organizations.createOrganization({
      name: CAPIRO_INTERNAL_NAME,
      slug: CAPIRO_INTERNAL_SLUG,
    });
    // eslint-disable-next-line no-console
    console.log(`Created Clerk org ${org.id} (${org.slug})`);
  }

  // Step 2 - DB tenant + metadata
  const prisma = new PrismaClient();
  let tenantId: string;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      const tenant = await tx.tenant.upsert({
        where: { slug: CAPIRO_INTERNAL_SLUG },
        create: {
          slug: CAPIRO_INTERNAL_SLUG,
          name: CAPIRO_INTERNAL_NAME,
          status: 'active',
          clerkOrgId: org!.id,
        },
        update: { clerkOrgId: org!.id, status: 'active' },
      });
      tenantId = tenant.id;
    });
    await clerk.organizations.updateOrganizationMetadata(org.id, {
      publicMetadata: {
        capiro_tenant_id: tenantId!,
        capiro_tenant_slug: CAPIRO_INTERNAL_SLUG,
      },
    });
  } finally {
    await prisma.$disconnect();
  }

  // Step 3a - direct add (staging bootstrap path). Pull the user out of
  // Clerk by email, ensure they're an org:admin of capiro-internal, then
  // insert the tenant_memberships row directly. Bypasses the Clerk
  // webhook entirely so a staging environment with no webhook configured
  // can still get an authenticated admin user.
  if (args.forceAdd) {
    const userList = await clerk.users.getUserList({
      emailAddress: [args.email],
      limit: 5,
    });
    const clerkUser = userList.data[0];
    if (!clerkUser) {
      throw new Error(
        `No Clerk user with email ${args.email} found under the configured CLERK_SECRET_KEY. Sign up first, then re-run.`,
      );
    }

    // Idempotent: skip if already a member.
    const memberships = await clerk.users.getOrganizationMembershipList({
      userId: clerkUser.id,
    });
    const alreadyInOrg = memberships.data.find((m) => m.organization.id === org.id);
    if (!alreadyInOrg) {
      await clerk.organizations.createOrganizationMembership({
        organizationId: org.id,
        userId: clerkUser.id,
        role: 'org:admin',
      });
    }

    const prismaForMembership = new PrismaClient();
    try {
      await prismaForMembership.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
        const user = await tx.user.upsert({
          where: { clerkUserId: clerkUser.id },
          create: {
            clerkUserId: clerkUser.id,
            email: args.email,
            firstName: clerkUser.firstName ?? null,
            lastName: clerkUser.lastName ?? null,
          },
          update: {
            email: args.email,
            firstName: clerkUser.firstName ?? undefined,
            lastName: clerkUser.lastName ?? undefined,
          },
        });
        await tx.tenantMembership.upsert({
          where: {
            tenantId_userId: { tenantId: tenantId!, userId: user.id },
          },
          create: {
            tenantId: tenantId!,
            userId: user.id,
            role: 'capiro_admin',
            status: 'active',
            joinedAt: new Date(),
          },
          update: { role: 'capiro_admin', status: 'active' },
        });
      });
    } finally {
      await prismaForMembership.$disconnect();
    }

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          mode: 'force-add',
          tenant: { id: tenantId!, slug: CAPIRO_INTERNAL_SLUG, clerkOrgId: org.id },
          user: { id: clerkUser.id, email: args.email },
          nextStep:
            'User is now a capiro_admin of capiro-internal in the DB. Sign out and back in to refresh the JWT claims.',
        },
        null,
        2,
      ),
    );
    return;
  }

  // Step 3 - invitation
  const pending = await clerk.organizations.getOrganizationInvitationList({
    organizationId: org.id,
    status: ['pending'],
  });
  const existing = pending.data.find((inv) => inv.emailAddress.toLowerCase() === args.email);
  if (existing && !args.resend) {
    // eslint-disable-next-line no-console
    console.log(
      `Pending invitation already exists for ${args.email} (${existing.id}). Pass --resend to refresh.`,
    );
    return;
  }
  if (existing && args.resend) {
    await clerk.organizations.revokeOrganizationInvitation({
      organizationId: org.id,
      invitationId: existing.id,
      requestingUserId: org.id,
    });
  }
  const invitation = await clerk.organizations.createOrganizationInvitation({
    organizationId: org.id,
    emailAddress: args.email,
    role: 'org:admin',
    redirectUrl: 'https://app.capiro.ai/sign-in',
  });
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        tenant: { id: tenantId!, slug: CAPIRO_INTERNAL_SLUG, clerkOrgId: org.id },
        invitation: { id: invitation.id, email: args.email, capiroRole: 'capiro_admin' },
        nextStep:
          'Open the email from Clerk, set a password, and accept the invite. The webhook will assign capiro_admin role automatically.',
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
