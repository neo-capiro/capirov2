TASK: Add a Documents tab to the client profile page.

## CONTEXT — READ FIRST:
- apps/web/src/pages/clients/ClientProfilePage.tsx (just created — has Overview, Capabilities, People, Workflows tabs)
- apps/web/src/pages/clients/clientTypes.ts (has ClientAttachment type)
- apps/api/prisma/schema.prisma (EngagementAttachment model exists — has clientId, fileName, contentType, byteSize, s3Key, bucket)
- apps/api/src/engagement/engagement.controller.ts (check if there are existing attachment endpoints)
- apps/web/src/theme.css (has existing .doc-* styles? check)

## WHAT TO BUILD

### 1. Add "Documents" tab to ClientProfilePage.tsx

In the tab navigation, add "Documents" as the 5th tab (after Workflows).

The Documents tab body should show:

1. **Upload zone** at top — a dashed-border drop zone area:
   - "Drop files here or click to upload"
   - Accepts PDF, DOC, DOCX, TXT, images
   - Uses a hidden file input triggered by clicking the zone
   - On file select: POST to the upload endpoint (see below)

2. **Document list** below — fetched from GET /api/clients/:clientId/attachments (or wherever existing client attachments are served):
   - Each row: file icon (colored by type), file name (bold), meta line (uploaded date, size), download button
   - Style: use .doc-item, .doc-icon, .doc-name, .doc-meta patterns from the mockup CSS (already in theme.css or add them)

3. **Notes textarea** at the bottom:
   - "Add any additional context about this client..."
   - Saves to client.intakeData.profileNotes via PATCH /api/clients/:id

### 2. Upload endpoint

Check if there's already an attachment upload endpoint for clients. Look at:
- apps/api/src/engagement/engagement.controller.ts for existing upload patterns
- apps/api/src/clients/ for any attachment endpoints

If no upload endpoint exists for client documents, create one:
- POST /api/clients/:clientId/documents — accepts multipart file upload
- Stores file in S3 under `tenants/{tenantId}/clients/{clientId}/documents/{filename}`
- Creates an EngagementAttachment record with clientId set
- Returns the created attachment

If there IS an existing upload endpoint, just use it.

Also need:
- GET /api/clients/:clientId/documents — list attachments where clientId matches
- DELETE /api/clients/:clientId/documents/:id — delete attachment

### 3. Download

For each document in the list, provide a download link. Check if there's an existing presigned URL endpoint or download endpoint. If not, add:
- GET /api/clients/:clientId/documents/:id/download — returns S3 presigned URL or streams the file

### 4. CSS

Add styles for the upload zone and document list if not already present:
- .doc-drop-zone — dashed border area
- .doc-item — flex row for each document
- .doc-icon — colored icon square
- .doc-name — file name text
- .doc-meta — secondary meta text
- .doc-actions — download/delete buttons

Match the existing Capiro styling.

## IMPORTANT
- The Documents tab feeds into the AI auto-fill feature — when users upload client docs here, the AI fill reads them to suggest form field values. So this is a critical data input surface.
- Follow existing patterns exactly (useApi, useQuery, useMutation, Ant Design)
- Tenant-scope all queries
