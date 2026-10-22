#!/usr/bin/env python3
"""Convert a question CSV (seed-questions.csv format) into SQL INSERTs for schema/schema.sql.

Usage: python3 csv_to_sql.py seed-questions.csv > seed.sql
Rows are inserted with status 'draft'; promote them through the CMS review workflow.
"""
import csv, json, sys

LETTERS = "abcd"

def q(s):
    return "NULL" if s in ("", None) else "'" + s.replace("'", "''") + "'"

def main(path):
    out = ["BEGIN;"]
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            opts = [row[f"option_{c}"] for c in LETTERS if row.get(f"option_{c}")]
            idx = LETTERS.index(row["correct_option"].strip().lower())
            if idx >= len(opts):
                sys.exit(f"{row['id']}: correct_option out of range")
            if len(row["question"]) > 160:
                sys.exit(f"{row['id']}: question longer than 160 chars")
            out.append(
                "INSERT INTO questions (id, external_ref, category_id, subcategory, type, text, options, "
                "correct_index, fact, difficulty, d_rating, family_safe, region_tag, valid_until, status) VALUES ("
                f"{q('q_' + row['id'].lower())}, {q(row['id'])}, {q(row['category'])}, {q(row['subcategory'])}, "
                f"{q(row['type'])}, {q(row['question'])}, {q(json.dumps(opts, ensure_ascii=False))}::jsonb, {idx}, "
                f"{q(row['fact'])}, {int(row['difficulty'])}, {1050 + 150 * int(row['difficulty'])}, "
                f"{row['family_safe'] == 'true'}, {q(row['region_tag'])}, {q(row['valid_until'])}, 'draft') "
                "ON CONFLICT (external_ref) DO NOTHING;"
            )
    out.append("COMMIT;")
    print("\n".join(out))

if __name__ == "__main__":
    main(sys.argv[1])
