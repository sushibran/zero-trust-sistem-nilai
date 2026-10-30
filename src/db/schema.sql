PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('mahasiswa', 'dosen', 'admin')),
  password_hash TEXT NOT NULL,
  nim TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  lecturer_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS enrollments (
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (course_id, student_id)
);

CREATE TABLE IF NOT EXISTS grades (
  id INTEGER PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id),
  student_id INTEGER NOT NULL REFERENCES users(id),
  score REAL CHECK (score IS NULL OR (score >= 0 AND score <= 100)),
  is_final INTEGER NOT NULL DEFAULT 0 CHECK (is_final IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (course_id, student_id)
);

CREATE TABLE IF NOT EXISTS transcripts (
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users(id),
  course_id INTEGER NOT NULL REFERENCES courses(id),
  score REAL NOT NULL CHECK (score >= 0 AND score <= 100),
  synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (student_id, course_id)
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS service_clients (
  id INTEGER PRIMARY KEY,
  client_id TEXT NOT NULL UNIQUE,
  secret_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role = 'service'),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
  subject TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  device_id TEXT,
  decision TEXT NOT NULL CHECK (decision IN ('allow', 'deny')),
  reason TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_devices_user_active ON devices(user_id, active);
CREATE INDEX IF NOT EXISTS idx_courses_lecturer ON courses(lecturer_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_student ON enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_grades_student ON grades(student_id);
CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(occurred_at);
