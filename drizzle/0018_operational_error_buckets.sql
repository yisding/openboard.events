-- P3-OPS: privacy-safe, bounded observability for caught application errors.
-- Raw messages and stacks remain in Cloudflare Workers Logs; this table keeps
-- only a SHA-256 fingerprint plus coarse routing metadata so the public health
-- probe can expose an aggregate count without leaking customer data.

CREATE TABLE operational_error_buckets (
  fingerprint text NOT NULL,
  feature text NOT NULL,
  code text NOT NULL,
  bucket_started_at timestamptz NOT NULL,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  occurrences integer NOT NULL DEFAULT 1 CHECK (occurrences > 0),
  PRIMARY KEY (fingerprint, feature, code, bucket_started_at)
);

CREATE INDEX operational_error_buckets_last_seen_idx
  ON operational_error_buckets(last_seen_at);
