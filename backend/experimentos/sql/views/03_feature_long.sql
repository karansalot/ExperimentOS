-- Long (tidy) form of the 12 anonymised features: one row per (user, feature).
CREATE OR REPLACE VIEW v_feature_long AS
UNPIVOT (
    SELECT row_id, treatment, visit, conversion, f0, f1, f2, f3, f4, f5, f6, f7, f8, f9, f10, f11 FROM experiment
)
ON f0, f1, f2, f3, f4, f5, f6, f7, f8, f9, f10, f11
INTO NAME feature VALUE value;
