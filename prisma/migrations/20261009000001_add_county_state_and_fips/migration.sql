-- County state + FIPS code, so a ZIP can resolve to a county in any US state.
--
-- Additive: both columns are nullable and older code never selects them.
-- Counties are now unique per organization by FIPS code, not by name:
-- "Washington" is a different county in some 30 states.

ALTER TABLE "counties"
  ADD COLUMN "stateCode" VARCHAR(2),
  ADD COLUMN "fipsCode" VARCHAR(5);

-- Every county so far was typed in for Pennsylvania. Names that are not a PA
-- county keep NULLs: they never resolved from a ZIP and stay hand-assignable.
WITH pa("name", "fipsCode") AS (
  VALUES
  ('Adams', '42001'),
  ('Allegheny', '42003'),
  ('Armstrong', '42005'),
  ('Beaver', '42007'),
  ('Bedford', '42009'),
  ('Berks', '42011'),
  ('Blair', '42013'),
  ('Bradford', '42015'),
  ('Bucks', '42017'),
  ('Butler', '42019'),
  ('Cambria', '42021'),
  ('Cameron', '42023'),
  ('Carbon', '42025'),
  ('Centre', '42027'),
  ('Chester', '42029'),
  ('Clarion', '42031'),
  ('Clearfield', '42033'),
  ('Clinton', '42035'),
  ('Columbia', '42037'),
  ('Crawford', '42039'),
  ('Cumberland', '42041'),
  ('Dauphin', '42043'),
  ('Delaware', '42045'),
  ('Elk', '42047'),
  ('Erie', '42049'),
  ('Fayette', '42051'),
  ('Forest', '42053'),
  ('Franklin', '42055'),
  ('Fulton', '42057'),
  ('Greene', '42059'),
  ('Huntingdon', '42061'),
  ('Indiana', '42063'),
  ('Jefferson', '42065'),
  ('Juniata', '42067'),
  ('Lackawanna', '42069'),
  ('Lancaster', '42071'),
  ('Lawrence', '42073'),
  ('Lebanon', '42075'),
  ('Lehigh', '42077'),
  ('Luzerne', '42079'),
  ('Lycoming', '42081'),
  ('McKean', '42083'),
  ('Mercer', '42085'),
  ('Mifflin', '42087'),
  ('Monroe', '42089'),
  ('Montgomery', '42091'),
  ('Montour', '42093'),
  ('Northampton', '42095'),
  ('Northumberland', '42097'),
  ('Perry', '42099'),
  ('Philadelphia', '42101'),
  ('Pike', '42103'),
  ('Potter', '42105'),
  ('Schuylkill', '42107'),
  ('Snyder', '42109'),
  ('Somerset', '42111'),
  ('Sullivan', '42113'),
  ('Susquehanna', '42115'),
  ('Tioga', '42117'),
  ('Union', '42119'),
  ('Venango', '42121'),
  ('Warren', '42123'),
  ('Washington', '42125'),
  ('Wayne', '42127'),
  ('Westmoreland', '42129'),
  ('Wyoming', '42131'),
  ('York', '42133')
),
matched AS (
  -- DISTINCT ON: "Adams" and "Adams County" in one organization are one county.
  SELECT DISTINCT ON (c."organizationId", pa."fipsCode")
    c."id",
    pa."fipsCode"
  FROM "counties" c
  JOIN pa
    ON lower(regexp_replace(trim(c."name"::text), '\s+county$', '', 'i')) = lower(pa."name")
  ORDER BY c."organizationId", pa."fipsCode", c."createdAt"
)
UPDATE "counties" c
SET "stateCode" = 'PA',
    "fipsCode" = matched."fipsCode"
FROM matched
WHERE c."id" = matched."id";

DROP INDEX IF EXISTS "unique_county_name_per_org";

CREATE UNIQUE INDEX "unique_county_fips_per_org" ON "counties"("fipsCode", "organizationId");
