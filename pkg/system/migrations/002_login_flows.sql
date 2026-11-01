-- OIDC sign-in flows in progress (P4). A flow is bound to the browser that
-- started it by a cookie whose hash is kept here; it lives ten minutes.
CREATE TABLE login_flows (
  state TEXT PRIMARY KEY,
  binding_hash TEXT NOT NULL,
  nonce TEXT NOT NULL,
  verifier TEXT NOT NULL,
  return_path TEXT NOT NULL,
  expires_at INTEGER NOT NULL);
