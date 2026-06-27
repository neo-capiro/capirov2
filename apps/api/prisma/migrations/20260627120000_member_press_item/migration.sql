-- CreateTable: member press/news items ingested from member RSS feeds
-- (scripts/sync-member-press.ts). GLOBAL table, no tenant_id, no RLS.
CREATE TABLE "member_press_item" (
    "id" UUID NOT NULL,
    "bioguide_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "published_at" TIMESTAMPTZ(6),
    "summary" TEXT,
    "source" TEXT,
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_press_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "member_press_item_bioguide_link_key" ON "member_press_item"("bioguide_id", "link");

-- CreateIndex
CREATE INDEX "member_press_item_bioguide_published_idx" ON "member_press_item"("bioguide_id", "published_at" DESC);
