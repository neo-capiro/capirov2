TASK: Phases B + C — Tenant contact settings, client address fields, and pre-population in the workflow drawer.

## CONTEXT
Read these files FIRST:
- apps/api/src/tenant-admin/tenant-admin.controller.ts (existing admin endpoints)
- apps/api/src/tenant-admin/tenant-admin.service.ts (existing admin service)
- apps/web/src/pages/settings/PersonalPage.tsx (existing settings page)
- apps/web/src/pages/settings/SettingsLayout.tsx (settings tabs)
- apps/web/src/pages/clients/clientTypes.ts (Client type definitions)
- apps/web/src/pages/clients/ClientWorkspacePage.tsx (client profiles page)
- apps/web/src/pages/workspace/WorkflowDrawer.tsx (current drawer)
- apps/web/src/lib/use-api.ts (API client hook)
- apps/web/src/lib/me.ts (current user/tenant info hook)
- apps/api/prisma/schema.prisma (Tenant.settings JSON, Client model fields)

The Tenant model has a `settings` JSON column. The Client model has `primaryContactName`, `primaryContactEmail`, `primaryContactPhone`, and `intakeData` JSON.

## PHASE B: Tenant Contact Settings

### B1. API: Add contact info endpoints to tenant-admin

In `apps/api/src/tenant-admin/tenant-admin.controller.ts`, add:

```
GET /api/tenant-admin/contact-info
```
Returns the tenant's contact info from settings.contactInfo (or empty object if not set).

```
PUT /api/tenant-admin/contact-info
```
Body: { name, phone, email, mailingStreet1, mailingStreet2, mailingCity, mailingStateZip, permanentStreet1, permanentStreet2, permanentCity, permanentStateZip }

Saves to tenant.settings.contactInfo. Use Prisma's JSON update to merge into the existing settings without losing other settings fields.

Add a DTO class `UpdateContactInfoDto` with all fields as @IsOptional() @IsString().

In `tenant-admin.service.ts`, add `getContactInfo(ctx)` and `updateContactInfo(ctx, dto)` methods.

### B2. Frontend: Add Contact Info tab to Settings

Create `apps/web/src/pages/settings/ContactInfoPage.tsx`:
- Ant Design Card with form fields for all contact info
- Two address sections: Mailing Address and Permanent Address
- Load existing data with GET /api/tenant-admin/contact-info
- Save with PUT /api/tenant-admin/contact-info
- Show success message on save
- Use Ant Design Form component with standard layout

Register in `apps/web/src/pages/settings/SettingsLayout.tsx`:
- Add tab: { key: '/settings/contact', label: 'Contact Info' } (visible to all roles, no minRole needed)

Register route in `apps/web/src/App.tsx`:
- Add `<Route path="contact" element={<ContactInfoPage />} />` inside the settings routes

### B3. Drawer: Pre-populate requester contact info

In `WorkflowDrawer.tsx`:
- Add a useQuery to fetch GET /api/tenant-admin/contact-info when drawer opens
- When the response arrives, for any field in the requesterContact section that has `source: "tenant_settings"`, auto-populate from the matching contact info field
- Map: requester_name → name, requester_phone → phone, requester_email → email, requester_mailing_street1 → mailingStreet1, etc.
- Only populate fields that are currently empty in formData (don't overwrite user edits)
- Show a small info badge: "Pre-populated from your organization settings"

## PHASE C: Client Address + Pre-population

### C1. Client address fields

The Client model already has intakeData JSON. We'll store address info there. No schema change needed.

In the existing client creation/edit form (find it in ClientWorkspacePage.tsx or ClientFormModal.tsx), add address fields to the client profile:
- address1, address2, city, state, zip
- pocName, pocTitle, pocPhone, pocEmail (primary point of contact)
- headName, headTitle (head of organization)

These go into intakeData: { ..., address1: "...", address2: "...", city: "...", state: "...", zip: "...", pocName: "...", etc. }

Read `apps/web/src/pages/clients/ClientFormModal.tsx` FIRST to understand the current form structure, then add the new fields in an "Address & Contact" section.

### C2. Drawer: Client dropdown + pre-population

In `WorkflowDrawer.tsx`:
- At the TOP of the drawer (before Section 1), add a Client dropdown (Select component)
  - Fetch clients list from GET /api/clients (same as other pages)
  - On client select:
    1. Save clientId to the workflow instance via PATCH /api/workflows/instances/:id { clientId }
    2. Pre-populate orgContact fields from the selected client:
       - org_name → client.name
       - org_address1 → client.intakeData.address1
       - org_address2 → client.intakeData.address2
       - org_city → client.intakeData.city
       - org_state → client.intakeData.state
       - org_zip → client.intakeData.zip
       - org_phone → client.primaryContactPhone
       - poc_name → client.primaryContactName or client.intakeData.pocName
       - poc_email → client.primaryContactEmail or client.intakeData.pocEmail
       - poc_phone → client.primaryContactPhone or client.intakeData.pocPhone
    3. Only populate empty fields (don't overwrite)
    4. Show info badge: "Pre-populated from client profile"

### C3. Show existing client if already associated

When the drawer opens, if the workflow instance already has a clientId, pre-select that client in the dropdown and show the populated data.

## IMPORTANT
- Do NOT change the Prisma schema. Use existing settings JSON and intakeData JSON columns.
- Follow existing code patterns exactly (useApi, useQuery, useMutation, Ant Design, etc.)
- Read the tenant-admin service to understand how it accesses Prisma for tenant updates.
- The tenant-admin service may use a different Prisma access pattern (direct vs withTenant). Match it.
- Keep the drawer's auto-save behavior intact.
- The client dropdown should use the same clients query pattern as AppShell.tsx.
