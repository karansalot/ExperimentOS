-- title: Data quality rule checks
-- technique: Data quality validation (UNION ALL of rule checks, conditional aggregation)
-- question: Do the rows satisfy the domain and logical constraints the analysis relies on?
WITH facts AS (
    SELECT
        count(*)                                                        AS n,
        count(*) - count(COLUMNS(* EXCLUDE (split)))                    AS dummy_never_used,
        sum((treatment NOT IN (0, 1))::INT)                             AS bad_treatment,
        sum((visit NOT IN (0, 1))::INT)                                 AS bad_visit,
        sum((conversion NOT IN (0, 1))::INT)                            AS bad_conversion,
        sum((exposure NOT IN (0, 1))::INT)                              AS bad_exposure,
        sum((conversion = 1 AND visit = 0)::INT)                        AS conversion_without_visit,
        sum((exposure = 1 AND treatment = 0)::INT)                      AS exposed_in_control,
        count(*) - count(DISTINCT row_id)                               AS duplicate_row_ids,
        sum((isnan(f0) OR isinf(f0) OR isnan(f1) OR isinf(f1) OR isnan(f2) OR isinf(f2)
          OR isnan(f3) OR isinf(f3) OR isnan(f4) OR isinf(f4) OR isnan(f5) OR isinf(f5)
          OR isnan(f6) OR isinf(f6) OR isnan(f7) OR isinf(f7) OR isnan(f8) OR isinf(f8)
          OR isnan(f9) OR isinf(f9) OR isnan(f10) OR isinf(f10) OR isnan(f11) OR isinf(f11))::INT)
                                                                        AS non_finite_feature_rows,
        sum((f0 IS NULL OR f1 IS NULL OR f2 IS NULL OR f3 IS NULL OR f4 IS NULL OR f5 IS NULL
          OR f6 IS NULL OR f7 IS NULL OR f8 IS NULL OR f9 IS NULL OR f10 IS NULL OR f11 IS NULL
          OR treatment IS NULL OR visit IS NULL OR conversion IS NULL OR exposure IS NULL)::INT)
                                                                        AS rows_with_any_null
    FROM experiment
)
SELECT 'no_null_values' AS check_name, 'error' AS severity, rows_with_any_null AS violating_rows, rows_with_any_null = 0 AS passed FROM facts
UNION ALL SELECT 'features_are_finite',            'error', non_finite_feature_rows,   non_finite_feature_rows = 0   FROM facts
UNION ALL SELECT 'treatment_is_binary',            'error', bad_treatment,             bad_treatment = 0             FROM facts
UNION ALL SELECT 'visit_is_binary',                'error', bad_visit,                 bad_visit = 0                 FROM facts
UNION ALL SELECT 'conversion_is_binary',           'error', bad_conversion,            bad_conversion = 0            FROM facts
UNION ALL SELECT 'exposure_is_binary',             'error', bad_exposure,              bad_exposure = 0              FROM facts
UNION ALL SELECT 'row_id_is_unique',               'error', duplicate_row_ids,         duplicate_row_ids = 0         FROM facts
UNION ALL SELECT 'conversion_implies_visit',       'warn',  conversion_without_visit,  conversion_without_visit = 0  FROM facts
UNION ALL SELECT 'control_is_never_exposed',       'warn',  exposed_in_control,        exposed_in_control = 0        FROM facts;
