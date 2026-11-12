package store

import "database/sql"

type Store struct{ db *sql.DB }

func New() *Store { return &Store{} }
