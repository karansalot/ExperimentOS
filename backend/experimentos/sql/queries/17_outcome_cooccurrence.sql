-- title: Visit x conversion co-occurrence by arm
-- technique: Contingency table with windowed shares (SUM() OVER PARTITION BY)
-- question: How do the two outcomes relate, and is conversion-given-visit different between arms? (Conditioning on visit is post-treatment: descriptive only.)
SELECT
    CASE WHEN treatment = 1 THEN 'treatment' ELSE 'control' END    AS arm,
    visit,
    conversion,
    count(*)                                                       AS n_users,
    round(count(*) / sum(count(*)) OVER (PARTITION BY treatment), 6)         AS share_of_arm,
    round(count(*) / sum(count(*)) OVER (PARTITION BY treatment, visit), 6)  AS share_within_visit_group
FROM experiment
GROUP BY treatment, visit, conversion
ORDER BY arm DESC, visit, conversion;
