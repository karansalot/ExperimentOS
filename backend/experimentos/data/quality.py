"""Data quality report assembled from the SQL validation queries and the ingest manifest."""
from __future__ import annotations

from .. import config

CARD_CLAIMS = [
    {"field": "Row count", "card_statement": "\"consists of 25M rows\" (description) vs \"Rows: 13,979,592\" (key figures)",
     "verified_key": "n_users"},
    {"field": "Feature count", "card_statement": "\"11 features\" (description) vs fields f0..f11 listed (12)", "verified_value": "12 feature columns (f0-f11)"},
    {"field": "Treatment ratio", "card_statement": ".85", "verified_key": "treatment_share"},
    {"field": "Average visit rate", "card_statement": ".046992", "verified_key": "visit_rate"},
    {"field": "Average conversion rate", "card_statement": ".00292", "verified_key": "conversion_rate"},
]


def _table(sql_results: list[dict], qid_prefix: str) -> list[dict]:
    r = next(q for q in sql_results if q["id"].startswith(qid_prefix))
    if r["status"] != "ok":
        return []
    return [dict(zip(r["columns"], row, strict=False)) for row in r["rows"]]


def build(sql_results: list[dict], manifest: dict, scope: config.Scope) -> dict:
    profile = _table(sql_results, "01_")[0]
    checks = _table(sql_results, "02_")
    dups = _table(sql_results, "03_")
    order = _table(sql_results, "11_")
    splits = _table(sql_results, "12_")
    sample = _table(sql_results, "18_")
    features = _table(sql_results, "06_")

    checks = [{**c, "passed": bool(c["passed"]), "violating_rows": int(c["violating_rows"])} for c in checks]
    expected = manifest["rows"][scope.name]
    checks.insert(0, {"check_name": "raw_file_sha256_matches_pinned_revision", "severity": "error",
                      "violating_rows": 0, "passed": bool(manifest["raw_file"].get("sha256_matches_pinned", False))})
    checks.insert(1, {"check_name": "row_count_matches_ingest_manifest", "severity": "error",
                      "violating_rows": abs(profile["n_users"] - expected), "passed": profile["n_users"] == expected})
    if not scope.is_sample:
        checks.insert(2, {"check_name": "row_count_matches_dataset_card_key_figure", "severity": "error",
                          "violating_rows": abs(profile["n_users"] - config.DATASET["expected_rows"]),
                          "passed": profile["n_users"] == config.DATASET["expected_rows"]})

    dup_rows = sum(int(d["total_rows"]) for d in dups if d["copies_per_distinct_row"] != "1")
    pure_blocks = sum(1 for b in order if b["treatment_share"] in (0, 1))
    visit_rates = [b["visit_rate"] for b in order]

    card = []
    for c in CARD_CLAIMS:
        v = c.get("verified_value")
        if v is None:
            raw = profile[c["verified_key"]]
            v = f"{raw:,}" if isinstance(raw, int) else f"{raw}"
        card.append({"field": c["field"], "card_statement": c["card_statement"], "verified": v,
                     "applies_to_scope": scope.label})

    findings = [
        {"severity": "info", "title": "No missing or non-finite values",
         "detail": "All 16 columns are complete and every binary column contains only 0/1."},
        {"severity": "info", "title": "No user identifier or timestamp",
         "detail": "Rows are described as users, but there is no key to verify uniqueness and no time dimension. "
                   "Time-based checks (novelty, day-of-week, sequential testing) are not possible."},
        {"severity": "warn", "title": f"{dup_rows:,} rows ({dup_rows / profile['n_users']:.1%}) are exact duplicates of another row",
         "detail": "Features are coarse and heavily concentrated, so identical rows can be distinct users. "
                   "Without a user id they cannot be attributed, so they are reported and kept."},
        {"severity": "warn", "title": "Row order is not random",
         "detail": f"{pure_blocks} of {len(order)} equal-size position blocks contain a single arm only, and block visit rates range "
                   f"from {min(visit_rates):.2%} to {max(visit_rates):.2%}. A sequential sample (e.g. the first N rows) or a "
                   "head/tail split would be badly biased. All sampling and splitting here uses a salted hash of row position."},
        {"severity": "info", "title": "Outcome hierarchy holds",
         "detail": "Every conversion is also a visit, and no control user is marked as exposed."},
    ]
    return {
        "profile": profile,
        "checks": checks,
        "all_error_checks_passed": all(c["passed"] for c in checks if c["severity"] == "error"),
        "duplicates": dups,
        "feature_profile": features,
        "file_order": order,
        "split_integrity": splits,
        "dev_sample_representativeness": sample,
        "dataset_card_comparison": card,
        "findings": findings,
        "columns": (
            [{"column": f, "type": "DOUBLE", "role": "Anonymised, randomly projected pre-treatment feature"} for f in config.FEATURES]
            + [
                {"column": "treatment", "type": "UTINYINT", "role": "1 = assigned to be eligible for advertising, 0 = held out (control)"},
                {"column": "conversion", "type": "UTINYINT", "role": "Outcome: the user converted"},
                {"column": "visit", "type": "UTINYINT", "role": "Outcome: the user visited the advertiser site"},
                {"column": "exposure", "type": "UTINYINT", "role": "Post-treatment: the user was effectively exposed to advertising"},
                {"column": "row_id", "type": "BIGINT", "role": "Added at ingest: 0-based position in the raw file"},
                {"column": "split_bucket / sample_bucket", "type": "UTINYINT", "role": "Added at ingest: salted hash buckets (0-99) for splits and the dev sample"},
            ]
        ),
    }
