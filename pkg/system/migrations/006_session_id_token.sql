-- The identity provider's ID token of an OIDC sign-in, kept with the main
-- host's session only as the id_token_hint of RP-initiated logout, so that
-- signing out also ends the provider's (ZITADEL's) browser session.
ALTER TABLE sessions ADD COLUMN id_token TEXT;
