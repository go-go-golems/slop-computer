-- The tables and columns DBSource reads, as they stand after francois's
-- migrations 001-021 (github.com/go-go-golems/francois@106776a,
-- pkg/catalog/store/migrations). Constraints the importer does not rely on
-- are left out.
CREATE TABLE users (
    id text PRIMARY KEY, issuer text NOT NULL, subject text NOT NULL, email text NOT NULL DEFAULT '',
    email_verified boolean NOT NULL DEFAULT false, display_name text NOT NULL DEFAULT '',
    role text NOT NULL DEFAULT 'subscriber', disabled boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(), last_login_at timestamptz, UNIQUE (issuer, subject));
CREATE TABLE catalog_artifacts (
    id text PRIMARY KEY, title text NOT NULL, description text NOT NULL DEFAULT '', tags text[] NOT NULL DEFAULT '{}',
    visibility text NOT NULL DEFAULT 'listed', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    page jsonb NOT NULL DEFAULT '{}', page_draft jsonb, featured boolean NOT NULL DEFAULT false, sort_order integer NOT NULL DEFAULT 0,
    demo_enabled boolean NOT NULL DEFAULT false, early_access_until timestamptz, launch_mode text NOT NULL DEFAULT 'tab');
CREATE TABLE releases (
    id text PRIMARY KEY, artifact_id text NOT NULL REFERENCES catalog_artifacts(id), version text NOT NULL,
    changelog text NOT NULL DEFAULT '', manifest jsonb NOT NULL, state text NOT NULL DEFAULT 'draft',
    free_sample boolean NOT NULL DEFAULT false, created_by text NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz, published_by text REFERENCES users(id),
    withdrawn_at timestamptz, UNIQUE (artifact_id, version));
CREATE TABLE release_files (
    id text PRIMARY KEY, release_id text NOT NULL REFERENCES releases(id), role text NOT NULL, name text NOT NULL,
    media_type text NOT NULL, size bigint NOT NULL, sha256 text NOT NULL, storage_key text NOT NULL, UNIQUE (release_id, role));
CREATE TABLE release_attachments (
    id text PRIMARY KEY, release_id text NOT NULL REFERENCES releases(id), name text NOT NULL, label text NOT NULL DEFAULT '',
    media_type text NOT NULL, size bigint NOT NULL, sha256 text NOT NULL, storage_key text NOT NULL,
    position integer NOT NULL DEFAULT 0, created_by text NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE catalog_media (
    id text PRIMARY KEY, sha256 text NOT NULL, storage_key text NOT NULL, media_type text NOT NULL, size bigint NOT NULL,
    width integer NOT NULL DEFAULT 0, height integer NOT NULL DEFAULT 0, alt text NOT NULL DEFAULT '',
    uploaded_by text NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
    poster_media_id text REFERENCES catalog_media(id));
CREATE TABLE creators (
    id text PRIMARY KEY, slug text NOT NULL UNIQUE, name text NOT NULL, bio text NOT NULL DEFAULT '',
    avatar_media_id text REFERENCES catalog_media(id), links jsonb NOT NULL DEFAULT '[]', user_id text UNIQUE REFERENCES users(id),
    sort_order integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE artifact_creators (
    artifact_id text NOT NULL REFERENCES catalog_artifacts(id), creator_id text NOT NULL REFERENCES creators(id),
    position integer NOT NULL DEFAULT 0, PRIMARY KEY (artifact_id, creator_id));
CREATE TABLE posts (
    id text PRIMARY KEY, slug text NOT NULL UNIQUE, title text NOT NULL, summary text NOT NULL DEFAULT '', body text NOT NULL DEFAULT '',
    cover_media_id text REFERENCES catalog_media(id), author_id text REFERENCES creators(id), tags text[] NOT NULL DEFAULT '{}',
    state text NOT NULL DEFAULT 'draft', published_at timestamptz, created_by text NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE instances (id text PRIMARY KEY, kind text NOT NULL DEFAULT 'workspace');
