-- Platform (CTF meta-layer) schema: players, challenges, solves, submission log.
-- Owned by ctf-platform. Session table (platform_sessions) is managed
-- automatically by connect-pg-simple at runtime.

CREATE TABLE IF NOT EXISTS players (
    id            SERIAL PRIMARY KEY,
    username      VARCHAR(32) UNIQUE NOT NULL,
    email         VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS challenges (
    id             SERIAL PRIMARY KEY,
    slug           VARCHAR(64) UNIQUE NOT NULL,
    title          VARCHAR(128) NOT NULL,
    description    TEXT NOT NULL,
    category       VARCHAR(64) NOT NULL,
    difficulty     VARCHAR(16) NOT NULL DEFAULT 'beginner',
    points         INTEGER NOT NULL DEFAULT 100,
    flag_hash      CHAR(64) NOT NULL,
    enabled        BOOLEAN NOT NULL DEFAULT TRUE,
    order_index    INTEGER NOT NULL DEFAULT 0,
    prerequisite_id INTEGER REFERENCES challenges(id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS solves (
    id             SERIAL PRIMARY KEY,
    player_id      INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    challenge_id   INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    submitted_flag TEXT NOT NULL,
    points_awarded INTEGER NOT NULL,
    solved_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (player_id, challenge_id)
);

CREATE TABLE IF NOT EXISTS submission_log (
    id           SERIAL PRIMARY KEY,
    player_id    INTEGER REFERENCES players(id) ON DELETE CASCADE,
    challenge_id INTEGER REFERENCES challenges(id) ON DELETE SET NULL,
    correct      BOOLEAN NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_solves_player ON solves(player_id);
CREATE INDEX IF NOT EXISTS idx_solves_challenge ON solves(challenge_id);
CREATE INDEX IF NOT EXISTS idx_submission_log_player ON submission_log(player_id);
CREATE INDEX IF NOT EXISTS idx_challenges_order ON challenges(order_index);
