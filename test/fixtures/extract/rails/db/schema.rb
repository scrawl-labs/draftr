ActiveRecord::Schema[7.1].define(version: 2024_01_01_000000) do
  create_table "accounts", force: :cascade do |t|
    t.string "name"
  end

  create_table "projects", force: :cascade do |t|
    t.bigint "account_id", null: false
    t.string "title"
    t.index ["account_id"], name: "index_projects_on_account_id"
  end

  add_foreign_key "projects", "accounts"
end
