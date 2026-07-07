use std::path::PathBuf;

use chrono::Utc;
use sqlx::{sqlite::SqlitePoolOptions, Row, SqlitePool};
use thiserror::Error;

use super::types::TaskSummary;

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
                updated_at TEXT NOT NULL
            )
            "#,
        )
        .execute(&pool)
        .await?;

        sqlx::query("CREATE INDEX IF NOT EXISTS idx_tasks_updated ON tasks(updated_at DESC)")
            .execute(&pool)
            .await?;
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_tasks_agent_session ON tasks(agent_session_id)",
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
    ) -> Result<TaskSummary, StoreError> {
        let pool = self.pool()?;
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            "INSERT INTO tasks (task_id, agent_session_id, cwd, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'idle', ?, ?)",
        )
        .bind(task_id)
        .bind(agent_session_id)
        .bind(cwd)
        .bind(title)
        .bind(&now)
        .bind(&now)
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
        })
    }

    pub async fn get(&self, task_id: &str) -> Result<Option<TaskSummary>, StoreError> {
        let pool = self.pool()?;
        let row = sqlx::query(
            "SELECT task_id, agent_session_id, cwd, title, status, created_at, updated_at FROM tasks WHERE task_id = ?",
        )
        .bind(task_id)
        .fetch_optional(pool)
        .await?;

        Ok(row.map(|r| row_to_summary(&r)))
    }

    pub async fn list_all(&self) -> Result<Vec<TaskSummary>, StoreError> {
        let pool = self.pool()?;
        let rows = sqlx::query(
            "SELECT task_id, agent_session_id, cwd, title, status, created_at, updated_at FROM tasks ORDER BY updated_at DESC",
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
    }
}
