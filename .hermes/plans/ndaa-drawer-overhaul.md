# NDAA Drawer Overhaul — Implementation Plan

## Overview
Restructure the NDAA Authorization Request workflow drawer to support two request types (Funding vs Policy/Bill Language), with pre-populated contact info from tenant settings and client profiles, plus AI-powered auto-fill from uploaded client documents.

## Phase A: Form Restructure (Funding vs Policy request types)

### Seed Data Update
Update the NDAA template's requiredSections to reflect the two-path form:
- Top-level toggle: "Funding Request" or "Policy/Bill Language Request"
- Each path has Section 1 (request details) and Section 2 (contact info)

### Funding Request — Section 1 Fields
1. Title of Request (text, 100 char)
2. Appropriations Account (text, 100 char)
3. Subcommittee (select: Airland, Cybersecurity, Emerging Threats and Capabilities, Personnel, Readiness and Management Support, Seapower, Strategic Forces)
4. Program (text, 100 char)
5. Program Element / PE (text, 100 char)
6. Line Number (text, 100 char)
7. Your FY2026 Requested Funding Amount (integer, no decimals/symbols)
8. President's FY2026 Budget Requested Funding Amount (integer, note: type "35" if PBR not released)
9. FY2025 Enacted Appropriations Bill Funding Amount (integer)
10. Brief explanation justifying the request (textarea)
11. Proposed report or bill language (textarea, optional + radio: report or bill)
12. How many funding requests is org submitting? (integer)
13. Priority Rank of Proposal (integer)
14. Connection to Massachusetts? (yes/no + conditional text field)
15. Submitted to other offices? (yes/no + conditional text field)

### Policy Request — Section 1 Fields
1. Title of Request (text, 100 char)
2. Purpose of language request (select: Bill Language, Report Language, Bill and Report Language)
3. Subcommittee (same select as funding)
4. Program (text, 100 char)
5. Program Element / PE (text, 100 char)
6. Line Number (text, 100 char)
7. Proposed Bill Language (textarea)
8. Proposed Report Language (textarea)
9. Brief explanation justifying the request (textarea)
10. How many language requests is org submitting? (integer)
11. Priority Rank of Proposal (integer)
12. Connection to Massachusetts? (yes/no + conditional)
13. Submitted to other offices? (yes/no + conditional)

### Both Types — Section 2: Contact Info

#### Requester Contact Info (pre-populated from tenant settings)
- Name, Phone, Email
- Mailing Address (Street 1, Street 2, City, State/Zip)
- Permanent Address (Street 1, Street 2, City, State/Zip)

#### Organization/Client Contact Info (pre-populated from selected client)
- Client dropdown (first field — select from client list)
- Name of Organization/Entity
- Name of Head of Organization
- Title of Head of Organization
- Address (Line 1, Line 2, City, State, ZIP)
- Phone Number
- Primary POC: Name, Title, Phone, Email
- Department of Defense Contact for Request

---

## Phase B: Tenant Settings for Contact Info

### Schema Change
Add to Tenant model (or use settings JSON):
- contactName, contactPhone, contactEmail
- mailingStreet1, mailingStreet2, mailingCity, mailingState, mailingZip
- permanentStreet1, permanentStreet2, permanentCity, permanentState, permanentZip

Better approach: use the existing `settings` JSON column on Tenant since it's already there.

### API
- PATCH /api/tenant-admin/contact-info — save tenant contact info to settings
- GET /api/tenant-admin/contact-info — retrieve it

### Frontend
- Add "Contact Information" section to Settings page (PersonalPage.tsx or new tab)
- Form with name, phone, email, mailing address, permanent address
- Save to tenant settings

### Drawer Integration
- On drawer open, fetch tenant contact info and pre-populate Section 2 requester fields

---

## Phase C: Client Profiles — Address + Documents

### Schema Changes
Add to Client model:
- address fields (or use intakeData JSON which already exists)
- pocName, pocTitle, pocPhone, pocEmail (or intakeData)

New model: ClientDocument
- id, tenantId, clientId, fileName, contentType, byteSize, s3Key, 
  extractedText (for LLM context), uploadedByUserId, createdAt

### API
- POST /api/clients/:id/documents — upload doc (S3 + extract text)
- GET /api/clients/:id/documents — list docs
- DELETE /api/clients/:id/documents/:docId
- POST /api/workflows/instances/:id/ai-fill — given instance + client, use LLM to suggest field values

### Frontend
- Client profile page: add Documents section with upload/list/delete
- Client profile: add address + POC contact fields
- Drawer: client dropdown → on select, populate org contact info from client profile

---

## Phase D: AI Auto-Fill from Client Documents

### Flow
1. User selects client in drawer
2. Client contact info auto-populates
3. "Auto-fill with AI" button appears
4. Backend: fetches client documents' extracted text, builds prompt with field definitions, calls LLM
5. Returns suggested values for text fields (program description, justification, etc.)
6. Frontend: shows suggestions with accept/reject per field

### API
POST /api/workflows/instances/:id/ai-fill
Body: { clientId, fields: string[] }
Response: { suggestions: { fieldKey: string, value: string, confidence: number }[] }

Uses ANTHROPIC_API_KEY or OPENAI_API_KEY already in secrets.

---

## Implementation Order
1. Phase A: Drawer form restructure (Claude Code — frontend only, update seed)
2. Phase B: Tenant contact settings + pre-population
3. Phase C: Client address/docs + pre-population
4. Phase D: AI auto-fill endpoint + UI
