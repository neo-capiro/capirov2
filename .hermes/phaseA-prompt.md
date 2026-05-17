TASK: Overhaul the NDAA Authorization Request workflow drawer and seed template — Phase A.

## CONTEXT
Read these files FIRST:
- apps/web/src/pages/workspace/WorkflowDrawer.tsx (current drawer)
- apps/web/src/pages/workspace/workflowTypes.ts (type definitions)
- apps/web/src/pages/workspace/KanbanBoard.tsx (opens the drawer)
- apps/api/prisma/seed-workflows.ts (current seed data)

## WHAT TO BUILD

### 1. Update seed template (apps/api/prisma/seed-workflows.ts)

Replace the requiredSections JSON with a new structure that supports two request types. The contextInfo should stay the same. The new requiredSections structure:

```json
{
  "requestTypes": ["funding", "policy"],
  "sections": {
    "funding": {
      "section1": {
        "title": "Funding Request",
        "fields": [
          { "key": "title_of_request", "label": "Title of Request", "type": "text", "maxLength": 100, "required": true },
          { "key": "appropriations_account", "label": "Appropriations Account", "type": "text", "maxLength": 100, "required": true },
          { "key": "subcommittee", "label": "Subcommittee", "type": "select", "required": true, "options": ["Airland", "Cybersecurity", "Emerging Threats and Capabilities", "Personnel", "Readiness and Management Support", "Seapower", "Strategic Forces"] },
          { "key": "program", "label": "Program", "type": "text", "maxLength": 100, "required": true },
          { "key": "program_element", "label": "Program Element (PE)", "type": "text", "maxLength": 100, "required": true, "helpText": "Please provide the most specific information you can." },
          { "key": "line_number", "label": "Line Number", "type": "text", "maxLength": 100, "required": true },
          { "key": "requested_funding_amount", "label": "Your FY2026 Requested Funding Amount", "type": "integer", "required": true, "helpText": "Please provide a specific dollar amount. No decimals or symbols." },
          { "key": "president_budget_amount", "label": "President's FY2026 Budget Requested Funding Amount", "type": "integer", "required": true, "helpText": "If the President's Budget is not yet released, please type 35. An email will be sent later allowing you to update." },
          { "key": "enacted_funding_amount", "label": "FY2025 Enacted Appropriations Bill Funding Amount", "type": "integer", "required": true, "helpText": "No decimals or symbols." },
          { "key": "justification", "label": "Brief explanation justifying the request", "type": "textarea", "required": true },
          { "key": "proposed_language", "label": "Proposed report or bill language", "type": "textarea", "required": false, "helpText": "If applicable, please provide the proposed report or bill language to accompany the funding request." },
          { "key": "proposed_language_type", "label": "Language type", "type": "select", "required": false, "options": ["Report", "Bill"], "helpText": "Please indicate if the provided language is for a report or bill." },
          { "key": "num_funding_requests", "label": "How many funding requests is your organization submitting?", "type": "integer", "required": true },
          { "key": "priority_rank", "label": "Priority Rank of Proposal", "type": "integer", "required": true, "helpText": "If only one proposal is being submitted, please enter 1." },
          { "key": "connection_to_massachusetts", "label": "Does this request have a connection to Massachusetts?", "type": "boolean", "required": true },
          { "key": "massachusetts_connection_detail", "label": "What is the connection to Massachusetts?", "type": "textarea", "required": false, "conditional": { "field": "connection_to_massachusetts", "value": true } },
          { "key": "submitted_other_offices", "label": "Have you submitted this request to other offices?", "type": "boolean", "required": true },
          { "key": "other_offices_detail", "label": "If yes, please list which other offices.", "type": "textarea", "required": false, "conditional": { "field": "submitted_other_offices", "value": true } }
        ]
      }
    },
    "policy": {
      "section1": {
        "title": "Bill/Report Language Request",
        "fields": [
          { "key": "title_of_request", "label": "Title of Request", "type": "text", "maxLength": 100, "required": true },
          { "key": "language_purpose", "label": "What is the purpose of the language request?", "type": "select", "required": true, "options": ["Bill Language", "Report Language", "Bill and Report Language"] },
          { "key": "subcommittee", "label": "Subcommittee", "type": "select", "required": true, "options": ["Airland", "Cybersecurity", "Emerging Threats and Capabilities", "Personnel", "Readiness and Management Support", "Seapower", "Strategic Forces"] },
          { "key": "program", "label": "Program", "type": "text", "maxLength": 100, "required": true },
          { "key": "program_element", "label": "Program Element (PE)", "type": "text", "maxLength": 100, "required": true },
          { "key": "line_number", "label": "Line Number", "type": "text", "maxLength": 100, "required": true },
          { "key": "proposed_bill_language", "label": "Proposed Bill Language", "type": "textarea", "required": false },
          { "key": "proposed_report_language", "label": "Proposed Report Language", "type": "textarea", "required": false, "helpText": "For examples of report language, please see FY25 NDAA Senate Report 118-188." },
          { "key": "justification", "label": "Brief explanation justifying the request", "type": "textarea", "required": true },
          { "key": "num_language_requests", "label": "How many language requests is your organization submitting?", "type": "integer", "required": true },
          { "key": "priority_rank", "label": "Priority Rank of Proposal", "type": "integer", "required": true, "helpText": "If only one proposal is being submitted, please enter 1." },
          { "key": "connection_to_massachusetts", "label": "Does this request have a connection to Massachusetts?", "type": "boolean", "required": true },
          { "key": "massachusetts_connection_detail", "label": "What is the connection to Massachusetts?", "type": "textarea", "required": false, "conditional": { "field": "connection_to_massachusetts", "value": true } },
          { "key": "submitted_other_offices", "label": "Have you submitted this request to other offices?", "type": "boolean", "required": true },
          { "key": "other_offices_detail", "label": "If yes, please list which other offices.", "type": "textarea", "required": false, "conditional": { "field": "submitted_other_offices", "value": true } }
        ]
      }
    },
    "shared": {
      "requesterContact": {
        "title": "Your Contact Information",
        "helpText": "Pre-populated from your organization settings. Update in Settings if needed.",
        "fields": [
          { "key": "requester_name", "label": "Name", "type": "text", "required": true, "source": "tenant_settings" },
          { "key": "requester_phone", "label": "Phone", "type": "text", "required": true, "source": "tenant_settings" },
          { "key": "requester_email", "label": "Email", "type": "text", "required": true, "source": "tenant_settings" },
          { "key": "requester_mailing_street1", "label": "Mailing Address - Street 1", "type": "text", "source": "tenant_settings" },
          { "key": "requester_mailing_street2", "label": "Mailing Address - Street 2", "type": "text", "source": "tenant_settings" },
          { "key": "requester_mailing_city", "label": "City", "type": "text", "source": "tenant_settings" },
          { "key": "requester_mailing_state_zip", "label": "State/Zip", "type": "text", "source": "tenant_settings" },
          { "key": "requester_permanent_street1", "label": "Permanent Address - Street 1", "type": "text", "source": "tenant_settings" },
          { "key": "requester_permanent_street2", "label": "Permanent Address - Street 2", "type": "text", "source": "tenant_settings" },
          { "key": "requester_permanent_city", "label": "City", "type": "text", "source": "tenant_settings" },
          { "key": "requester_permanent_state_zip", "label": "State/Zip", "type": "text", "source": "tenant_settings" }
        ]
      },
      "orgContact": {
        "title": "Organization/Entity Contact Information",
        "helpText": "Select a client to pre-populate.",
        "fields": [
          { "key": "org_name", "label": "Name of the Organization/Entity", "type": "text", "maxLength": 100, "required": true, "source": "client" },
          { "key": "org_head_name", "label": "Name of Head of the Organization/Entity", "type": "text", "maxLength": 100, "required": true },
          { "key": "org_head_title", "label": "Title of Head of the Organization/Entity", "type": "text", "maxLength": 100, "required": true },
          { "key": "org_address1", "label": "Address Line 1", "type": "text", "maxLength": 100, "source": "client" },
          { "key": "org_address2", "label": "Address Line 2", "type": "text", "maxLength": 100, "source": "client" },
          { "key": "org_city", "label": "City", "type": "text", "maxLength": 100, "source": "client" },
          { "key": "org_state", "label": "State/Territories/Armed Forces", "type": "select", "options": ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC","PR","VI","GU","AS","MP","AA","AE","AP"], "source": "client" },
          { "key": "org_zip", "label": "ZIP Code", "type": "text", "helpText": "##### or #####-####", "source": "client" },
          { "key": "org_phone", "label": "Phone Number", "type": "text", "helpText": "###-###-####", "source": "client" },
          { "key": "poc_name", "label": "Primary POC - Name", "type": "text", "maxLength": 100, "required": true, "source": "client" },
          { "key": "poc_title", "label": "Primary POC - Title", "type": "text", "maxLength": 100 },
          { "key": "poc_phone", "label": "Primary POC - Phone", "type": "text", "helpText": "###-###-####", "source": "client" },
          { "key": "poc_email", "label": "Primary POC - Email", "type": "text", "helpText": "i.e. your-email@mail.com", "source": "client" },
          { "key": "dod_contact", "label": "Department of Defense Contact for Request", "type": "text", "maxLength": 100 }
        ]
      }
    }
  }
}
```

Keep the contextInfo the same. Keep all other template fields the same.

### 2. Rewrite WorkflowDrawer.tsx

Completely rewrite the drawer component. Read the CURRENT WorkflowDrawer.tsx first to understand how it integrates with KanbanBoard (props, callbacks, etc.), then rebuild it with this structure:

**Layout:**
1. Header: workflow title (editable), status badge, template name
2. Request Type toggle: Radio group — "Funding Request" / "Policy/Bill Language Request"
   - Store as `formData.request_type` = "funding" | "policy"
   - Default to "funding" if not set
3. Section 1: Dynamic fields based on selected request type
   - Read fields from template.requiredSections.sections[requestType].section1.fields
   - Render each field by type:
     - text → Input with maxLength
     - integer → InputNumber (no decimals, formatter to add commas for display)
     - textarea → Input.TextArea (autoSize)
     - select → Select with options from the field definition
     - boolean → Radio group (Yes / No), with conditional sub-field if conditional prop exists
4. Section 2: Contact Info (shared between both types)
   - "Your Contact Information" section — fields from shared.requesterContact
     - For now, just render as editable text fields (Phase B will add pre-population)
   - "Organization Contact Information" section — fields from shared.orgContact
     - For now, just render as editable text fields (Phase C will add client dropdown)
5. Footer: Save button, progress indicator, auto-save status

**Form behavior:**
- All field values stored in formData JSON as { [field.key]: value }
- Boolean fields stored as true/false
- Conditional fields only visible when parent field matches the conditional value
- Auto-save with 1.5s debounce (same as current implementation)
- Progress indicator: count required fields that have non-empty values
- Integer fields: no decimals or symbols, display with comma formatting

**Field rendering approach:**
Do NOT hardcode field definitions in the component. Read them from the template's requiredSections JSON. Build a generic field renderer that handles each type. This way when we add new templates in the future, the drawer adapts automatically.

### 3. Update workflowTypes.ts

Update the TypeScript interfaces to match the new requiredSections structure. Add:
- RequestType = 'funding' | 'policy'
- FieldDefinition with all new properties (maxLength, options, helpText, conditional, source)
- SectionDefinition, RequestSections interfaces

### 4. Add styles to theme.css

Add/update CSS at the END for the new drawer layout:
- .workflow-drawer-type-toggle — request type radio group, prominent at top
- .workflow-drawer-section — section container with title
- .workflow-drawer-field — individual field wrapper
- .workflow-drawer-field-help — help text below field
- .workflow-drawer-conditional — conditional field (slightly indented, with visual connector)
- .workflow-drawer-boolean — yes/no radio group inline
- .workflow-drawer-contact-section — contact info section styling

Keep it clean and professional. Use existing CSS vars. Government affairs users.

## IMPORTANT
- Do NOT break the KanbanBoard integration — keep the same props/callbacks
- Do NOT change the API — formData is still a JSON blob, we're just changing what goes in it
- The drawer must be fully functional with the new field structure
- Match existing code patterns (useApi, useQuery, useMutation, Ant Design components)
- Keep auto-save behavior
