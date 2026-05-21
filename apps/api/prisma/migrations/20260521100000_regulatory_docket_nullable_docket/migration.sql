-- AlterTable: regulatory_docket — make docket_id nullable
ALTER TABLE "regulatory_docket" ALTER COLUMN "docket_id" DROP NOT NULL;
