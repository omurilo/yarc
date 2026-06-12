package storage

import (
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

func Open(path string) (*sql.DB, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}

	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}

	if _, err := db.Exec(schema); err != nil {
		_ = db.Close()
		return nil, err
	}
	_ = ensureColumn(db, "collections", "request_json", "text")

	return db, nil
}

type StoredHistory struct {
	ID           string
	RequestJSON  string
	ResponseJSON string
	CreatedAt    string
}

type StoredCollection struct {
	ID          string
	ParentID    string
	Kind        string
	Name        string
	Method      string
	URL         string
	TagsJSON    string
	Favorite    bool
	RequestJSON string
	CreatedAt   string
	UpdatedAt   string
}

func UpsertCollection(db *sql.DB, collection StoredCollection) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if collection.CreatedAt == "" {
		collection.CreatedAt = now
	}
	collection.UpdatedAt = now
	if collection.TagsJSON == "" {
		collection.TagsJSON = "[]"
	}

	_, err := db.Exec(
		`insert into collections (id, parent_id, kind, name, method, url, tags_json, favorite, request_json, created_at, updated_at)
		 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 on conflict(id) do update set
			parent_id = excluded.parent_id,
			kind = excluded.kind,
			name = excluded.name,
			method = excluded.method,
			url = excluded.url,
			tags_json = excluded.tags_json,
			favorite = excluded.favorite,
			request_json = excluded.request_json,
			updated_at = excluded.updated_at`,
		collection.ID,
		collection.ParentID,
		collection.Kind,
		collection.Name,
		collection.Method,
		collection.URL,
		collection.TagsJSON,
		collection.Favorite,
		collection.RequestJSON,
		collection.CreatedAt,
		collection.UpdatedAt,
	)
	return err
}

func ListCollections(db *sql.DB) ([]StoredCollection, error) {
	rows, err := db.Query(
		`select id, coalesce(parent_id, ''), kind, name, coalesce(method, ''), coalesce(url, ''), tags_json, favorite, coalesce(request_json, ''), created_at, updated_at
		   from collections
		  order by kind = 'workspace' desc, name asc`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	collections := []StoredCollection{}
	for rows.Next() {
		var collection StoredCollection
		if err := rows.Scan(
			&collection.ID,
			&collection.ParentID,
			&collection.Kind,
			&collection.Name,
			&collection.Method,
			&collection.URL,
			&collection.TagsJSON,
			&collection.Favorite,
			&collection.RequestJSON,
			&collection.CreatedAt,
			&collection.UpdatedAt,
		); err != nil {
			return nil, err
		}
		collections = append(collections, collection)
	}
	return collections, rows.Err()
}

func DeleteCollections(db *sql.DB, ids []string) error {
	if len(ids) == 0 {
		return nil
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`delete from collections where id = ?`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, id := range ids {
		if _, err := stmt.Exec(id); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func ensureColumn(db *sql.DB, table string, column string, definition string) error {
	rows, err := db.Query("pragma table_info(" + table + ")")
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var cid int
		var name, colType string
		var notNull int
		var defaultValue any
		var pk int
		if err := rows.Scan(&cid, &name, &colType, &notNull, &defaultValue, &pk); err != nil {
			return err
		}
		if name == column {
			return nil
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}

	_, err = db.Exec("alter table " + table + " add column " + column + " " + definition)
	return err
}

func EnsureWorkspace(db *sql.DB) error {
	collections, err := ListCollections(db)
	if err != nil {
		return err
	}
	if len(collections) > 0 {
		return nil
	}

	tags, _ := json.Marshal([]string{})
	return UpsertCollection(db, StoredCollection{
		ID:       "workspace",
		Kind:     "workspace",
		Name:     "Workspace",
		TagsJSON: string(tags),
	})
}

func InsertHistory(db *sql.DB, method string, url string, requestJSON string, responseJSON string, statusCode int, durationMS int64) error {
	_, err := db.Exec(
		`insert into history (id, method, url, request_json, response_json, status_code, duration_ms, created_at)
		 values (?, ?, ?, ?, ?, ?, ?, ?)`,
		time.Now().Format("20060102150405.000000000"),
		method,
		url,
		requestJSON,
		responseJSON,
		statusCode,
		durationMS,
		time.Now().UTC().Format(time.RFC3339Nano),
	)
	return err
}

func ListHistory(db *sql.DB, query string) ([]StoredHistory, error) {
	like := "%" + query + "%"
	rows, err := db.Query(
		`select id, request_json, response_json, created_at
		   from history
		  where ? = '' or url like ? or method like ? or request_json like ? or response_json like ?
		  order by created_at desc
		  limit 200`,
		query,
		like,
		like,
		like,
		like,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	entries := []StoredHistory{}
	for rows.Next() {
		var entry StoredHistory
		if err := rows.Scan(&entry.ID, &entry.RequestJSON, &entry.ResponseJSON, &entry.CreatedAt); err != nil {
			return nil, err
		}
		entries = append(entries, entry)
	}
	return entries, rows.Err()
}

func UpsertEnvironment(db *sql.DB, id string, name string, payload string, active bool) error {
	_, err := db.Exec(
		`insert into environments (id, name, payload_json, active, updated_at)
		 values (?, ?, ?, ?, ?)
		 on conflict(id) do update set name = excluded.name, payload_json = excluded.payload_json, active = excluded.active, updated_at = excluded.updated_at`,
		id,
		name,
		payload,
		active,
		time.Now().UTC().Format(time.RFC3339Nano),
	)
	return err
}

func ListEnvironments(db *sql.DB) ([]string, error) {
	rows, err := db.Query(`select payload_json from environments order by active desc, name asc`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	envs := []string{}
	for rows.Next() {
		var payload string
		if err := rows.Scan(&payload); err != nil {
			return nil, err
		}
		envs = append(envs, payload)
	}
	return envs, rows.Err()
}

const schema = `
pragma journal_mode = wal;
pragma foreign_keys = on;

create table if not exists collections (
	id text primary key,
	parent_id text,
	kind text not null,
	name text not null,
	method text,
	url text,
	tags_json text not null default '[]',
	favorite integer not null default 0,
	request_json text,
	created_at text not null,
	updated_at text not null
);

create table if not exists environments (
	id text primary key,
	name text not null,
	payload_json text not null,
	active integer not null default 0,
	updated_at text not null
);

create table if not exists history (
	id text primary key,
	method text not null,
	url text not null,
	request_json text not null,
	response_json text not null,
	status_code integer not null,
	duration_ms integer not null,
	created_at text not null
);

create virtual table if not exists history_fts using fts5(url, method, request_json, response_json, content='history', content_rowid='rowid');
`
