ALTER TABLE bloxio_users ADD COLUMN google_sub TEXT;

CREATE UNIQUE INDEX bloxio_users_google_sub_idx
  ON bloxio_users(google_sub);
