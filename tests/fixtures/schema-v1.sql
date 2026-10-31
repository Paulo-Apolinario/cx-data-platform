CREATE TABLE migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
BEGIN;
      CREATE TABLE users (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('ENGINEER','CLIENT')),
        active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE UNIQUE INDEX single_engineer ON users(role) WHERE role = 'ENGINEER';
      CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, address TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '', client_id TEXT REFERENCES users(id),
        start_date TEXT, end_date TEXT, budget_cents INTEGER NOT NULL DEFAULT 0 CHECK(budget_cents >= 0),
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','PAUSED','COMPLETED')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE stages (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL, start_date TEXT, end_date TEXT,
        status TEXT NOT NULL DEFAULT 'PLANNED' CHECK(status IN ('PLANNED','IN_PROGRESS','COMPLETED')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE attachments (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        stage_id TEXT REFERENCES stages(id) ON DELETE SET NULL,
        kind TEXT NOT NULL CHECK(kind IN ('PHOTO','DOCUMENT')), title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '', record_date TEXT NOT NULL,
        visible_to_client INTEGER NOT NULL DEFAULT 0 CHECK(visible_to_client IN (0,1)),
        file_name TEXT NOT NULL, mime_type TEXT NOT NULL, size INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE materials (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL, unit TEXT NOT NULL, quantity REAL NOT NULL CHECK(quantity >= 0),
        notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE expenses (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        description TEXT NOT NULL, category TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
        expense_date TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('PENDING','PAID')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE workers (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL, job_title TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '',
        active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL REFERENCES users(id),
        action TEXT NOT NULL, entity_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX stages_project ON stages(project_id);
      CREATE INDEX attachments_project ON attachments(project_id, visible_to_client);
      CREATE INDEX materials_project ON materials(project_id);
      CREATE INDEX expenses_project ON expenses(project_id);
      CREATE INDEX workers_project ON workers(project_id);
      INSERT INTO migrations(version) VALUES (1);
    COMMIT;