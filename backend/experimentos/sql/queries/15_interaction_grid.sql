-- title: Two-way interaction grid with subtotals
-- technique: GROUPING SETS with GROUPING() to label subtotal rows
-- question: Do two engagement-like features (f0 and f8 off their modal value) interact in the treatment effect?
WITH modes AS (
    SELECT feature, value AS mode_value FROM v_feature_segments WHERE segment_id = 0
),
flags AS (
    SELECT
        e.treatment,
        e.visit,
        e.f0 <> (SELECT mode_value FROM modes WHERE feature = 'f0') AS f0_non_modal,
        e.f8 <> (SELECT mode_value FROM modes WHERE feature = 'f8') AS f8_non_modal
    FROM experiment e
)
SELECT
    CASE WHEN grouping(f0_non_modal) = 1 THEN 'ALL' ELSE f0_non_modal::VARCHAR END AS f0_non_modal,
    CASE WHEN grouping(f8_non_modal) = 1 THEN 'ALL' ELSE f8_non_modal::VARCHAR END AS f8_non_modal,
    count(*)                                                    AS n_users,
    round(avg(visit) FILTER (WHERE treatment = 0), 5)           AS control_visit_rate,
    round(avg(visit) FILTER (WHERE treatment = 1), 5)           AS treatment_visit_rate,
    round(avg(visit) FILTER (WHERE treatment = 1)
        - avg(visit) FILTER (WHERE treatment = 0), 5)           AS visit_effect
FROM flags
GROUP BY GROUPING SETS ((f0_non_modal, f8_non_modal), (f0_non_modal), (f8_non_modal), ())
ORDER BY grouping(f0_non_modal), grouping(f8_non_modal), f0_non_modal, f8_non_modal;
