import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

export function openDatabase(dataDir) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(resolve(dataDir, 'obras.sqlite'));
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  `);
  if (!db.prepare('SELECT version FROM migrations WHERE version = 1').get()) {
    db.exec(`BEGIN;
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
    COMMIT;`);
  }
  if (!db.prepare('SELECT version FROM migrations WHERE version = 2').get()) {
    db.exec(`BEGIN IMMEDIATE;
      ALTER TABLE stages ADD COLUMN weight REAL NOT NULL DEFAULT 1 CHECK(weight > 0 AND weight <= 1000);
      ALTER TABLE stages ADD COLUMN progress_percent REAL NOT NULL DEFAULT 0 CHECK(progress_percent BETWEEN 0 AND 100);
      ALTER TABLE stages ADD COLUMN responsible TEXT NOT NULL DEFAULT '';
      ALTER TABLE stages ADD COLUMN actual_start TEXT;
      ALTER TABLE stages ADD COLUMN actual_end TEXT;
      UPDATE stages SET progress_percent=100 WHERE status='COMPLETED';
      ALTER TABLE expenses ADD COLUMN supplier TEXT NOT NULL DEFAULT '';
      ALTER TABLE expenses ADD COLUMN due_date TEXT;
      CREATE TABLE material_movements (
        id TEXT PRIMARY KEY, material_id TEXT NOT NULL REFERENCES materials(id),
        type TEXT NOT NULL CHECK(type IN ('OPENING','ENTRY','CONSUMPTION','LOSS','TRANSFER_OUT','TRANSFER_IN')),
        quantity REAL NOT NULL CHECK(quantity > 0), delta REAL NOT NULL,
        movement_date TEXT NOT NULL, supplier TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
        transfer_id TEXT, author_id TEXT REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO material_movements(id,material_id,type,quantity,delta,movement_date,notes)
        SELECT 'opening-'||id,id,'OPENING',quantity,quantity,date(created_at),'Saldo anterior preservado na migração'
        FROM materials WHERE quantity > 0;
      CREATE INDEX movements_material ON material_movements(material_id);
      CREATE TABLE expense_payments (
        id TEXT PRIMARY KEY, expense_id TEXT NOT NULL REFERENCES expenses(id),
        amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), payment_date TEXT NOT NULL,
        method TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
        receipt_id TEXT REFERENCES attachments(id), author_id TEXT REFERENCES users(id),
        voided_at TEXT, void_reason TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO expense_payments(id,expense_id,amount_cents,payment_date,notes)
        SELECT 'legacy-'||id,id,amount_cents,expense_date,'Pagamento anterior preservado na migração' FROM expenses WHERE status='PAID';
      CREATE INDEX payments_expense ON expense_payments(expense_id);
      CREATE TABLE diary_entries (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), work_date TEXT NOT NULL,
        weather TEXT NOT NULL DEFAULT '', services TEXT NOT NULL, occurrences TEXT NOT NULL DEFAULT '',
        internal_notes TEXT NOT NULL DEFAULT '', workforce_json TEXT NOT NULL DEFAULT '[]',
        attachment_ids_json TEXT NOT NULL DEFAULT '[]', visible_to_client INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 1, archived INTEGER NOT NULL DEFAULT 0,
        author_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE diary_revisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, diary_id TEXT NOT NULL REFERENCES diary_entries(id),
        version INTEGER NOT NULL, snapshot_json TEXT NOT NULL, author_id TEXT NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(diary_id,version)
      );
      CREATE INDEX diary_project ON diary_entries(project_id,work_date);
      CREATE TABLE approvals (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), client_id TEXT REFERENCES users(id),
        title TEXT NOT NULL, description TEXT NOT NULL, amount_cents INTEGER NOT NULL DEFAULT 0 CHECK(amount_cents >= 0),
        deadline TEXT, status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PENDING','APPROVED','REJECTED','CANCELLED')),
        decision_note TEXT NOT NULL DEFAULT '', decided_by TEXT REFERENCES users(id), decided_at TEXT,
        sent_at TEXT, created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX approvals_project ON approvals(project_id,status);
      INSERT INTO migrations(version) VALUES(2);
    COMMIT;`);
  }
  if (!db.prepare('SELECT version FROM migrations WHERE version = 3').get()) {
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE questions (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
        client_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE question_messages (
        id TEXT PRIMARY KEY, question_id TEXT NOT NULL REFERENCES questions(id),
        author_id TEXT NOT NULL REFERENCES users(id), message TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX questions_project ON questions(project_id,client_id);
      CREATE INDEX messages_question ON question_messages(question_id);
      INSERT INTO migrations(version) VALUES(3);
    COMMIT;`);
  }
  if (!db.prepare('SELECT version FROM migrations WHERE version = 4').get()) {
    db.exec(`BEGIN IMMEDIATE;
      ALTER TABLE materials ADD COLUMN minimum_quantity REAL NOT NULL DEFAULT 0 CHECK(minimum_quantity>=0);
      ALTER TABLE material_movements ADD COLUMN reverses_id TEXT REFERENCES material_movements(id);
      CREATE UNIQUE INDEX movement_reversal ON material_movements(reverses_id) WHERE reverses_id IS NOT NULL;
      CREATE TABLE stock_reservations (
        id TEXT PRIMARY KEY, material_id TEXT NOT NULL REFERENCES materials(id),
        stage_id TEXT REFERENCES stages(id), purpose TEXT NOT NULL, quantity REAL NOT NULL CHECK(quantity>0),
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','CONSUMED','RELEASED')),
        movement_id TEXT REFERENCES material_movements(id), author_id TEXT NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE purchases (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), material_id TEXT NOT NULL REFERENCES materials(id),
        quantity REAL NOT NULL CHECK(quantity>0), needed_date TEXT, notes TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'QUOTING' CHECK(status IN ('QUOTING','ORDERED','RECEIVED','CANCELLED')),
        selected_quote_id TEXT REFERENCES purchase_quotes(id), expense_id TEXT REFERENCES expenses(id),
        movement_id TEXT REFERENCES material_movements(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE purchase_quotes (
        id TEXT PRIMARY KEY, purchase_id TEXT NOT NULL REFERENCES purchases(id), supplier TEXT NOT NULL,
        unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents>0), freight_cents INTEGER NOT NULL CHECK(freight_cents>=0),
        total_cents INTEGER NOT NULL CHECK(total_cents>0), delivery_date TEXT, notes TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE selections (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), client_id TEXT REFERENCES users(id),
        title TEXT NOT NULL, location TEXT NOT NULL DEFAULT '', deadline TEXT,
        status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PENDING','SELECTED','REJECTED','CANCELLED')),
        selected_option_id TEXT REFERENCES selection_options(id), decided_by TEXT REFERENCES users(id),
        decided_at TEXT, decision_note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE selection_options (
        id TEXT PRIMARY KEY, selection_id TEXT NOT NULL REFERENCES selections(id), title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '', amount_cents INTEGER NOT NULL DEFAULT 0 CHECK(amount_cents>=0),
        image_id TEXT REFERENCES attachments(id)
      );
      CREATE TABLE inspections (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), client_id TEXT REFERENCES users(id),
        title TEXT NOT NULL, description TEXT NOT NULL, location TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','IN_PROGRESS','RESOLVED','CLOSED')),
        responsible TEXT NOT NULL DEFAULT '', due_date TEXT, attachment_ids_json TEXT NOT NULL DEFAULT '[]',
        created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE inspection_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, inspection_id TEXT NOT NULL REFERENCES inspections(id),
        status TEXT NOT NULL, note TEXT NOT NULL, author_id TEXT NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE operation_requests (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result_json TEXT NOT NULL);
      CREATE INDEX reservations_material ON stock_reservations(material_id,status);
      CREATE INDEX purchases_project ON purchases(project_id);
      CREATE INDEX selections_project ON selections(project_id,client_id);
      CREATE INDEX inspections_project ON inspections(project_id,client_id);
      INSERT INTO migrations(version) VALUES(4);
    COMMIT;`);
  }
  if (!db.prepare('SELECT version FROM migrations WHERE version = 5').get()) {
    db.exec(`BEGIN IMMEDIATE;
      ALTER TABLE purchases ADD COLUMN purchase_date TEXT;
      ALTER TABLE purchases ADD COLUMN supplier TEXT NOT NULL DEFAULT '';
      ALTER TABLE purchases ADD COLUMN unit_price_cents INTEGER;
      ALTER TABLE purchases ADD COLUMN freight_cents INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE purchases ADD COLUMN total_cents INTEGER;
      ALTER TABLE purchases ADD COLUMN invoice_number TEXT NOT NULL DEFAULT '';
      UPDATE purchases SET purchase_date=(SELECT expense_date FROM expenses WHERE id=purchases.expense_id),
        supplier=COALESCE((SELECT supplier FROM purchase_quotes WHERE id=purchases.selected_quote_id),''),
        unit_price_cents=(SELECT unit_price_cents FROM purchase_quotes WHERE id=purchases.selected_quote_id),
        freight_cents=COALESCE((SELECT freight_cents FROM purchase_quotes WHERE id=purchases.selected_quote_id),0),
        total_cents=(SELECT amount_cents FROM expenses WHERE id=purchases.expense_id)
        WHERE status='RECEIVED';
      INSERT INTO migrations(version) VALUES(5);
    COMMIT;`);
  }
  return db;
}
