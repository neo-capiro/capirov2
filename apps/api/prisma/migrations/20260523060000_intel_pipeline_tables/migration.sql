-- CreateTable: SEC EDGAR filings
CREATE TABLE "sec_filing" (
    "id" TEXT NOT NULL,
    "cik" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "form_type" TEXT NOT NULL,
    "accession_number" TEXT NOT NULL,
    "filing_date" DATE NOT NULL,
    "report_date" DATE,
    "primary_doc" TEXT,
    "description" TEXT,
    "sic" TEXT,
    "state_of_incorp" TEXT,
    "fiscal_year_end" TEXT,
    "url" TEXT,
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sec_filing_pkey" PRIMARY KEY ("id")
);

-- CreateTable: FARA registrations
CREATE TABLE "fara_registration" (
    "id" TEXT NOT NULL,
    "registration_number" TEXT NOT NULL,
    "registrant_name" TEXT NOT NULL,
    "foreign_principal" TEXT NOT NULL,
    "country" TEXT,
    "status" TEXT,
    "registration_date" DATE,
    "termination_date" DATE,
    "address" TEXT,
    "state" TEXT,
    "description" TEXT,
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fara_registration_pkey" PRIMARY KEY ("id")
);

-- CreateTable: BLS series
CREATE TABLE "bls_series" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "survey_name" TEXT,
    "area" TEXT,
    "industry" TEXT,
    "period_type" TEXT NOT NULL,
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bls_series_pkey" PRIMARY KEY ("id")
);

-- CreateTable: BLS data points
CREATE TABLE "bls_data_point" (
    "id" TEXT NOT NULL,
    "series_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "period" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "footnotes" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "bls_data_point_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Census district demographics
CREATE TABLE "census_district" (
    "id" TEXT NOT NULL,
    "congress" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "state_fips" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "total_population" INTEGER,
    "median_household_income" INTEGER,
    "median_age" DOUBLE PRECISION,
    "percent_bachelor_plus" DOUBLE PRECISION,
    "percent_poverty" DOUBLE PRECISION,
    "percent_veteran" DOUBLE PRECISION,
    "percent_uninsured" DOUBLE PRECISION,
    "labor_force_size" INTEGER,
    "unemployment_rate" DOUBLE PRECISION,
    "top_industries" JSONB NOT NULL DEFAULT '[]',
    "data_year" INTEGER NOT NULL,
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "census_district_pkey" PRIMARY KEY ("id")
);

-- CreateTable: BEA economic data
CREATE TABLE "bea_data" (
    "id" TEXT NOT NULL,
    "dataset_name" TEXT NOT NULL,
    "table_name" TEXT NOT NULL,
    "line_number" INTEGER,
    "series_code" TEXT,
    "description" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "period" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "units" TEXT,
    "geo_fips" TEXT,
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bea_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Federal grant opportunities
CREATE TABLE "federal_grant" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "agency" TEXT NOT NULL,
    "sub_agency" TEXT,
    "opportunity_number" TEXT,
    "category" TEXT,
    "funding_instrument" TEXT,
    "eligibility" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cfda_numbers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "award_ceiling" DOUBLE PRECISION,
    "award_floor" DOUBLE PRECISION,
    "estimated_funding" DOUBLE PRECISION,
    "expected_awards" INTEGER,
    "open_date" DATE,
    "close_date" DATE,
    "status" TEXT,
    "description" TEXT,
    "url" TEXT,
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "federal_grant_pkey" PRIMARY KEY ("id")
);

-- CreateTable: GAO reports
CREATE TABLE "gao_report" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "publish_date" DATE,
    "report_type" TEXT,
    "topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "agencies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "summary" TEXT,
    "recommendations" INTEGER,
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gao_report_pkey" PRIMARY KEY ("id")
);

-- CreateTable: State bills (OpenStates)
CREATE TABLE "state_bill" (
    "id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "session" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "chamber" TEXT,
    "classification" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "subjects" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sponsor_name" TEXT,
    "sponsor_party" TEXT,
    "latest_action_date" DATE,
    "latest_action_text" TEXT,
    "url" TEXT,
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "state_bill_pkey" PRIMARY KEY ("id")
);

-- CreateTable: State legislators
CREATE TABLE "state_legislator" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "chamber" TEXT,
    "district" TEXT,
    "party" TEXT,
    "email" TEXT,
    "image" TEXT,
    "url" TEXT,
    "committees" JSONB NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "state_legislator_pkey" PRIMARY KEY ("id")
);

-- CreateTable: CRS reports
CREATE TABLE "crs_report" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "date" DATE,
    "authors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "summary" TEXT,
    "pdf_url" TEXT,
    "html_url" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crs_report_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Intel articles (RSS news)
CREATE TABLE "intel_article" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "feed_url" TEXT,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "author" TEXT,
    "published_at" TIMESTAMPTZ(6) NOT NULL,
    "summary" TEXT,
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "agencies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intel_article_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Committee hearings
CREATE TABLE "committee_hearing" (
    "id" TEXT NOT NULL,
    "chamber" TEXT NOT NULL,
    "committee_name" TEXT NOT NULL,
    "committee_code" TEXT,
    "title" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "time" TEXT,
    "location" TEXT,
    "type" TEXT,
    "witnesses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "url" TEXT,
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "committee_hearing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sec_filing_accession_number_key" ON "sec_filing"("accession_number");
CREATE INDEX "sec_filing_cik_idx" ON "sec_filing"("cik");
CREATE INDEX "sec_filing_form_type_filing_date_idx" ON "sec_filing"("form_type", "filing_date");
CREATE INDEX "sec_filing_company_name_idx" ON "sec_filing"("company_name");

-- CreateIndex
CREATE UNIQUE INDEX "fara_registration_registration_number_key" ON "fara_registration"("registration_number");
CREATE INDEX "fara_registration_registrant_name_idx" ON "fara_registration"("registrant_name");
CREATE INDEX "fara_registration_foreign_principal_idx" ON "fara_registration"("foreign_principal");
CREATE INDEX "fara_registration_country_idx" ON "fara_registration"("country");

-- CreateIndex
CREATE UNIQUE INDEX "bls_data_point_series_id_year_period_key" ON "bls_data_point"("series_id", "year", "period");
CREATE INDEX "bls_data_point_series_id_year_idx" ON "bls_data_point"("series_id", "year");

-- CreateIndex
CREATE INDEX "census_district_congress_state_idx" ON "census_district"("congress", "state");
CREATE INDEX "census_district_state_district_idx" ON "census_district"("state", "district");

-- CreateIndex
CREATE UNIQUE INDEX "bea_data_dataset_name_table_name_series_code_year_period_ge_key" ON "bea_data"("dataset_name", "table_name", "series_code", "year", "period", "geo_fips");
CREATE INDEX "bea_data_dataset_name_year_idx" ON "bea_data"("dataset_name", "year");
CREATE INDEX "bea_data_geo_fips_idx" ON "bea_data"("geo_fips");

-- CreateIndex
CREATE INDEX "federal_grant_agency_idx" ON "federal_grant"("agency");
CREATE INDEX "federal_grant_close_date_idx" ON "federal_grant"("close_date");
CREATE INDEX "federal_grant_status_idx" ON "federal_grant"("status");

-- CreateIndex
CREATE INDEX "gao_report_publish_date_idx" ON "gao_report"("publish_date");
CREATE INDEX "gao_report_report_type_idx" ON "gao_report"("report_type");

-- CreateIndex
CREATE INDEX "state_bill_state_session_idx" ON "state_bill"("state", "session");
CREATE INDEX "state_bill_state_latest_action_date_idx" ON "state_bill"("state", "latest_action_date");

-- CreateIndex
CREATE INDEX "state_legislator_state_chamber_idx" ON "state_legislator"("state", "chamber");
CREATE INDEX "state_legislator_party_state_idx" ON "state_legislator"("party", "state");

-- CreateIndex
CREATE INDEX "crs_report_date_idx" ON "crs_report"("date");

-- CreateIndex
CREATE UNIQUE INDEX "intel_article_url_key" ON "intel_article"("url");
CREATE INDEX "intel_article_source_published_at_idx" ON "intel_article"("source", "published_at");
CREATE INDEX "intel_article_published_at_idx" ON "intel_article"("published_at");

-- CreateIndex
CREATE INDEX "committee_hearing_date_idx" ON "committee_hearing"("date");
CREATE INDEX "committee_hearing_committee_name_date_idx" ON "committee_hearing"("committee_name", "date");

-- AddForeignKey
ALTER TABLE "bls_data_point" ADD CONSTRAINT "bls_data_point_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "bls_series"("id") ON DELETE CASCADE ON UPDATE CASCADE;
