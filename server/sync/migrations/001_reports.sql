CREATE TABLE IF NOT EXISTS retail_reports (
  source_id uuid PRIMARY KEY,
  document_date timestamp without time zone NOT NULL,
  sync_date date NOT NULL,
  number text,
  posted boolean NOT NULL DEFAULT false,
  deletion_mark boolean NOT NULL DEFAULT false,
  store_id uuid,
  cashbox_id uuid,
  net_amount numeric(18,2),
  returns_amount numeric(18,2),
  raw_data jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS retail_reports_date_idx ON retail_reports (sync_date, document_date DESC);
CREATE INDEX IF NOT EXISTS retail_reports_store_idx ON retail_reports (store_id, sync_date);

CREATE TABLE IF NOT EXISTS retail_report_lines (
  report_id uuid NOT NULL REFERENCES retail_reports(source_id) ON DELETE CASCADE,
  line_kind text NOT NULL CHECK (line_kind IN ('sale', 'return')),
  line_number integer NOT NULL,
  product_id uuid,
  warehouse_id uuid,
  seller_id uuid,
  quantity numeric(18,3),
  amount numeric(18,2),
  raw_data jsonb NOT NULL,
  PRIMARY KEY (report_id, line_kind, line_number)
);
CREATE INDEX IF NOT EXISTS retail_report_lines_product_idx ON retail_report_lines (product_id);
CREATE INDEX IF NOT EXISTS retail_report_lines_warehouse_idx ON retail_report_lines (warehouse_id);
CREATE INDEX IF NOT EXISTS retail_report_lines_seller_idx ON retail_report_lines (seller_id);

CREATE TABLE IF NOT EXISTS sync_days (
  data_type text NOT NULL,
  sync_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','running','completed','failed')),
  started_at timestamptz,
  completed_at timestamptz,
  records_count integer,
  error text,
  PRIMARY KEY (data_type, sync_date)
);
CREATE TABLE IF NOT EXISTS sync_jobs (
  id bigserial PRIMARY KEY,
  data_type text NOT NULL,
  sync_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','running','completed','failed')),
  attempt integer NOT NULL DEFAULT 0,
  run_after timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (data_type, sync_date)
);
CREATE INDEX IF NOT EXISTS sync_jobs_next_idx ON sync_jobs (run_after, id) WHERE status = 'pending';
CREATE TABLE IF NOT EXISTS sync_schedule (sync_date date PRIMARY KEY, scheduled_at timestamptz NOT NULL DEFAULT now());
