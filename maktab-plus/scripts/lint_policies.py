#!/usr/bin/env python3
"""Fail CI if any CREATE POLICY uses an UNQUALIFIED column name.

Why: inside a policy subquery, `student_id` silently binds to the nearest table
(attack A1 in v2: `g.student_id = student_id` was always true). Rule: every
column in a policy is written as table.column or alias.column.

Usage: python3 scripts/lint_policies.py db/*.sql      (needs: pip install pglast)
"""
import sys
from pglast import parse_sql
from pglast.visitors import Visitor


class Cols(Visitor):
    def __init__(self):
        self.bad = []

    def visit_ColumnRef(self, ancestors, node):
        names = [getattr(f, "sval", "*") for f in node.fields]
        if len(names) == 1 and names[0] != "*":
            self.bad.append(names[0])


def main(files):
    errors = 0
    for path in files:
        src = open(path, encoding="utf-8").read()
        for raw in parse_sql(src):
            st = raw.stmt
            if type(st).__name__ not in ("CreatePolicyStmt", "AlterPolicyStmt"):
                continue
            v = Cols()
            for part in (st.qual, st.with_check):
                if part is not None:
                    v(part)
            for col in sorted(set(v.bad)):
                errors += 1
                print(f"{path}: policy {st.policy_name} on {st.table.relname}: unqualified column '{col}'")
    if errors:
        print(f"lint_policies: {errors} problem(s)")
        sys.exit(1)
    print("lint_policies: OK")


if __name__ == "__main__":
    main(sys.argv[1:])
