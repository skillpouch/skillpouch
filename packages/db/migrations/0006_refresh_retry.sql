-- phase: expand
-- When the refresh token was last rotated. A client that retries a refresh
-- whose response it never received presents the previous token; within a
-- short window (and with the same DPoP key) that is a retry, not theft.
ALTER TABLE devices ADD COLUMN refresh_rotated_at timestamptz;
