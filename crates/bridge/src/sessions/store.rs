use std::path::PathBuf;

use chrono::Utc;
use sqlx::{sqlite::SqlitePoolOptions, Row, SqlitePool};
use thiserror::Error;

use super::types::TaskSummary;
use crate::agui::AguiEvent;

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("task not found: {0}")]
    NotFound(String),
    #[error("store not initialized")]
    NotInitialized,
}

pub struct SessionStore {
    db_path: PathBuf,
    pool: Option<SqlitePool>,
}

impl SessionStore {
    pub fn new(db_path: impl Into<PathBuf>) -> Self {
        Self {
            db_path: db_path.into(),
            pool: None,
        }
    }

    pub async fn initialize(&mut self) -> Result<(), StoreError> {
        if let Some(parent) = self.db_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        let url = format!("sqlite:{}?mode=rwc", self.db_path.display());
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect(&url)
            .await?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS tasks (
                task_id TEXT PRIMARY KEY,
                agent_session_id TEXT NOT NULL,
                cwd TEXT NOT NULL,
                title TEXT NOT NULL DEFAULT 'New Task',
                status TEXT NOT NULL DEFAULT 'idle',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                agent_id TEXT
            )
            "#,
        )
        .execute(&pool)
        .await?;

        // Best-effort migration for DBs created before agent_id existed.
        let _ = sqlx::query("ALTER TABLE tasks ADD COLUMN agent_id TEXT")
            .execute(&pool)
            .await;

        sqlx::query("CREATE INDEX IF NOT EXISTS idx_tasks_updated ON tasks(updated_at DESC)")
            .execute(&pool)
            .await?;
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_tasks_agent_session ON tasks(agent_session_id)",
        )
        .execute(&pool)
        .await?;

        // Events table for conversation history
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id TEXT NOT NULL,
                run_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                event_data TEXT NOT NULL,
                timestamp REAL NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(task_id) REFERENCES tasks(task_id) ON DELETE CASCADE
            )
            "#,
        )
        .execute(&pool)
        .await?;

        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_events_task_run ON events(task_id, run_id, id ASC)",
        )
        .execute(&pool)
        .await?;

        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at)",
        )
        .execute(&pool)
        .await?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS git_bindings (
                task_id TEXT PRIMARY KEY,
                cwd TEXT NOT NULL,
                repo_root TEXT NOT NULL,
                base_branch TEXT,
                base_sha TEXT NOT NULL,
                agent_branch TEXT NOT NULL,
                tip_sha TEXT,
                enabled INTEGER NOT NULL DEFAULT 0,
                pre_rewind_sha TEXT,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(task_id) REFERENCES tasks(task_id) ON DELETE CASCADE
            )
            "#,
        )
        .execute(&pool)
        .await?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS git_turn_commits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id TEXT NOT NULL,
                run_id TEXT NOT NULL,
                commit_sha TEXT NOT NULL,
                parent_sha TEXT NOT NULL,
                message TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(task_id) REFERENCES tasks(task_id) ON DELETE CASCADE
            )
            "#,
        )
        .execute(&pool)
        .await?;

        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_git_turns_task ON git_turn_commits(task_id, id ASC)",
        )
        .execute(&pool)
        .await?;

        self.pool = Some(pool);
        Ok(())
    }

    fn pool(&self) -> Result<&SqlitePool, StoreError> {
        self.pool.as_ref().ok_or(StoreError::NotInitialized)
    }

    pub async fn create(
        &self,
        task_id: &str,
        agent_session_id: &str,
        cwd: &str,
        title: &str,
        agent_id: Option<&str>,
    ) -> Result<TaskSummary, StoreError> {
        let pool = self.pool()?;
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            r#"
            INSERT INTO tasks (task_id, agent_session_id, cwd, title, status, created_at, updated_at, agent_id)
            VALUES (?, ?, ?, ?, 'idle', ?, ?, ?)
            ON CONFLICT(task_id) DO UPDATE SET
                agent_session_id = excluded.agent_session_id,
                cwd = excluded.cwd,
                title = excluded.title,
                updated_at = excluded.updated_at,
                agent_id = COALESCE(excluded.agent_id, tasks.agent_id)
            "#,
        )
        .bind(task_id)
        .bind(agent_session_id)
        .bind(cwd)
        .bind(title)
        .bind(&now)
        .bind(&now)
        .bind(agent_id)
        .execute(pool)
        .await?;

        Ok(TaskSummary {
            task_id: task_id.to_string(),
            agent_session_id: agent_session_id.to_string(),
            cwd: cwd.to_string(),
            title: title.to_string(),
            status: "idle".to_string(),
            created_at: now.clone(),
            updated_at: now,
            agent_id: agent_id.map(|s| s.to_string()),
            current_run_id: None,
        })
    }

    pub async fn get(&self, task_id: &str) -> Result<Option<TaskSummary>, StoreError> {
        let pool = self.pool()?;
        let row = sqlx::query(
            "SELECT task_id, agent_session_id, cwd, title, status, created_at, updated_at, agent_id FROM tasks WHERE task_id = ?",
        )
        .bind(task_id)
        .fetch_optional(pool)
        .await?;

        Ok(row.map(|r| row_to_summary(&r)))
    }

    pub async fn list_all(&self) -> Result<Vec<TaskSummary>, StoreError> {
        let pool = self.pool()?;
        let rows = sqlx::query(
            "SELECT task_id, agent_session_id, cwd, title, status, created_at, updated_at, agent_id FROM tasks ORDER BY updated_at DESC",
        )
        .fetch_all(pool)
        .await?;

        Ok(rows.iter().map(row_to_summary).collect())
    }

    pub async fn update(
        &self,
        task_id: &str,
        title: Option<&str>,
        status: Option<&str>,
    ) -> Result<TaskSummary, StoreError> {
        let pool = self.pool()?;
        let now = Utc::now().to_rfc3339();

        if title.is_none() && status.is_none() {
            return self
                .get(task_id)
                .await?
                .ok_or_else(|| StoreError::NotFound(task_id.to_string()));
        }

        if let Some(title) = title {
            sqlx::query("UPDATE tasks SET title = ?, updated_at = ? WHERE task_id = ?")
                .bind(title)
                .bind(&now)
                .bind(task_id)
                .execute(pool)
                .await?;
        }

        if let Some(status) = status {
            sqlx::query("UPDATE tasks SET status = ?, updated_at = ? WHERE task_id = ?")
                .bind(status)
                .bind(&now)
                .bind(task_id)
                .execute(pool)
                .await?;
        }

        self.get(task_id)
            .await?
            .ok_or_else(|| StoreError::NotFound(task_id.to_string()))
    }

    pub async fn delete(&self, task_id: &str) -> Result<bool, StoreError> {
        let pool = self.pool()?;
        let result = sqlx::query("DELETE FROM tasks WHERE task_id = ?")
            .bind(task_id)
            .execute(pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn close(&mut self) {
        if let Some(pool) = self.pool.take() {
            pool.close().await;
        }
    }

    /// Save an event to the events table
    pub async fn save_event(
        &self,
        task_id: &str,
        run_id: &str,
        event_type: &str,
        event_data: &str,
        timestamp: f64,
    ) -> Result<(), StoreError> {
        let pool = self.pool()?;
        let created_at = Utc::now().to_rfc3339();
        sqlx::query(
            r#"
            INSERT INTO events (task_id, run_id, event_type, event_data, timestamp, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(task_id)
        .bind(run_id)
        .bind(event_type)
        .bind(event_data)
        .bind(timestamp)
        .bind(&created_at)
        .execute(pool)
        .await?;
        Ok(())
    }

    /// Get all events for a task in chronological order
    pub async fn get_events_for_task(&self, task_id: &str) -> Result<Vec<AguiEvent>, StoreError> {
        let pool = self.pool()?;
        let rows = sqlx::query(
            "SELECT event_data FROM events WHERE task_id = ? ORDER BY id ASC",
        )
        .bind(task_id)
        .fetch_all(pool)
        .await?;

        let mut events = Vec::new();
        for row in rows {
            let event_data: String = row.get("event_data");
            if let Ok(event) = serde_json::from_str::<AguiEvent>(&event_data) {
                events.push(event);
            } else {
                tracing::warn!("failed to deserialize event: {}", event_data);
            }
        }
        Ok(events)
    }

    /// Get all events for a specific run
    pub async fn get_events_for_run(
        &self,
        task_id: &str,
        run_id: &str,
    ) -> Result<Vec<AguiEvent>, StoreError> {
        Ok(self
            .get_events_for_run_after(task_id, run_id, 0)
            .await?
            .into_iter()
            .map(|(_, event)| event)
            .collect())
    }

    /// Events for a run with row ids, optionally after a given id (exclusive).
    pub async fn get_events_for_run_after(
        &self,
        task_id: &str,
        run_id: &str,
        after_id: i64,
    ) -> Result<Vec<(i64, AguiEvent)>, StoreError> {
        let pool = self.pool()?;
        let rows = sqlx::query(
            "SELECT id, event_data FROM events WHERE task_id = ? AND run_id = ? AND id > ? ORDER BY id ASC",
        )
        .bind(task_id)
        .bind(run_id)
        .bind(after_id)
        .fetch_all(pool)
        .await?;

        let mut events = Vec::new();
        for row in rows {
            let id: i64 = row.get("id");
            let event_data: String = row.get("event_data");
            if let Ok(event) = serde_json::from_str::<AguiEvent>(&event_data) {
                events.push((id, event));
            } else {
                tracing::warn!("failed to deserialize event for run: {}", event_data);
            }
        }
        Ok(events)
    }

    /// Latest run_id for a task (by most recent event row).
    pub async fn latest_run_id(&self, task_id: &str) -> Result<Option<String>, StoreError> {
        let pool = self.pool()?;
        let row = sqlx::query(
            "SELECT run_id FROM events WHERE task_id = ? ORDER BY id DESC LIMIT 1",
        )
        .bind(task_id)
        .fetch_optional(pool)
        .await?;
        Ok(row.map(|r| r.get::<String, _>("run_id")))
    }

    /// Whether a run already has a terminal AG-UI event.
    pub async fn run_is_complete(
        &self,
        task_id: &str,
        run_id: &str,
    ) -> Result<bool, StoreError> {
        let pool = self.pool()?;
        let row = sqlx::query(
            r#"
            SELECT 1 AS ok FROM events
            WHERE task_id = ? AND run_id = ?
              AND event_type IN ('RUN_FINISHED', 'RUN_ERROR')
            LIMIT 1
            "#,
        )
        .bind(task_id)
        .bind(run_id)
        .fetch_optional(pool)
        .await?;
        Ok(row.is_some())
    }

    /// Delete events older than the specified number of days
    pub async fn delete_old_events(&self, days: u32) -> Result<u64, StoreError> {
        let pool = self.pool()?;
        let cutoff = Utc::now() - chrono::Duration::days(days as i64);
        let cutoff_str = cutoff.to_rfc3339();
        let result = sqlx::query("DELETE FROM events WHERE created_at < ?")
            .bind(&cutoff_str)
            .execute(pool)
            .await?;
        Ok(result.rows_affected())
    }

    /// Cleanup old events using default TTL of 30 days
    pub async fn cleanup_events(&self) -> Result<u64, StoreError> {
        self.delete_old_events(30).await
    }

    pub async fn upsert_git_binding(
        &self,
        binding: &super::git_session::GitSessionBinding,
    ) -> Result<(), StoreError> {
        let pool = self.pool()?;
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            r#"
            INSERT INTO git_bindings (
                task_id, cwd, repo_root, base_branch, base_sha, agent_branch,
                tip_sha, enabled, pre_rewind_sha, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(task_id) DO UPDATE SET
                cwd = excluded.cwd,
                repo_root = excluded.repo_root,
                base_branch = excluded.base_branch,
                base_sha = excluded.base_sha,
                agent_branch = excluded.agent_branch,
                tip_sha = excluded.tip_sha,
                enabled = excluded.enabled,
                pre_rewind_sha = excluded.pre_rewind_sha,
                updated_at = excluded.updated_at
            "#,
        )
        .bind(&binding.task_id)
        .bind(&binding.cwd)
        .bind(&binding.repo_root)
        .bind(&binding.base_branch)
        .bind(&binding.base_sha)
        .bind(&binding.agent_branch)
        .bind(&binding.tip_sha)
        .bind(if binding.enabled { 1 } else { 0 })
        .bind(&binding.pre_rewind_sha)
        .bind(&now)
        .execute(pool)
        .await?;
        Ok(())
    }

    pub async fn get_git_binding(
        &self,
        task_id: &str,
    ) -> Result<Option<super::git_session::GitSessionBinding>, StoreError> {
        let pool = self.pool()?;
        let row = sqlx::query(
            r#"
            SELECT task_id, cwd, repo_root, base_branch, base_sha, agent_branch,
                   tip_sha, enabled, pre_rewind_sha
            FROM git_bindings WHERE task_id = ?
            "#,
        )
        .bind(task_id)
        .fetch_optional(pool)
        .await?;

        Ok(row.map(|r| super::git_session::GitSessionBinding {
            task_id: r.get("task_id"),
            cwd: r.get("cwd"),
            repo_root: r.get("repo_root"),
            base_branch: r.get("base_branch"),
            base_sha: r.get("base_sha"),
            agent_branch: r.get("agent_branch"),
            tip_sha: r.get("tip_sha"),
            enabled: r.get::<i64, _>("enabled") != 0,
            pre_rewind_sha: r.get("pre_rewind_sha"),
        }))
    }

    pub async fn insert_git_turn_commit(
        &self,
        turn: &super::git_session::GitTurnCommit,
    ) -> Result<(), StoreError> {
        let pool = self.pool()?;
        sqlx::query(
            r#"
            INSERT INTO git_turn_commits (task_id, run_id, commit_sha, parent_sha, message, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&turn.task_id)
        .bind(&turn.run_id)
        .bind(&turn.commit_sha)
        .bind(&turn.parent_sha)
        .bind(&turn.message)
        .bind(&turn.created_at)
        .execute(pool)
        .await?;
        Ok(())
    }

    pub async fn list_git_turn_commits(
        &self,
        task_id: &str,
    ) -> Result<Vec<super::git_session::GitTurnCommit>, StoreError> {
        let pool = self.pool()?;
        let rows = sqlx::query(
            r#"
            SELECT task_id, run_id, commit_sha, parent_sha, message, created_at
            FROM git_turn_commits WHERE task_id = ? ORDER BY id ASC
            "#,
        )
        .bind(task_id)
        .fetch_all(pool)
        .await?;

        Ok(rows
            .iter()
            .map(|r| super::git_session::GitTurnCommit {
                task_id: r.get("task_id"),
                run_id: r.get("run_id"),
                commit_sha: r.get("commit_sha"),
                parent_sha: r.get("parent_sha"),
                message: r.get("message"),
                created_at: r.get("created_at"),
            })
            .collect())
    }
}

fn row_to_summary(row: &sqlx::sqlite::SqliteRow) -> TaskSummary {
    TaskSummary {
        task_id: row.get("task_id"),
        agent_session_id: row.get("agent_session_id"),
        cwd: row.get("cwd"),
        title: row.get("title"),
        status: row.get("status"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
        agent_id: row.try_get("agent_id").ok().flatten(),
        current_run_id: None,
    }
}
