-- ============================================================
-- Migration A: Global cost-code catalog (Scheduling Analytics, Slice B, Phase 5 / 5a)
--
-- WHAT & WHY (plain English):
--   Today a schedule activity is just a name. This adds a SHARED, company-wide
--   CATALOG of cost codes (the standard CSI MasterFormat accounting codes an
--   estimator already uses — e.g. `09-2116.001  Gypsum Board Assemblies`). A
--   canonical activity in the global `activity_dictionary` can then be stamped
--   with one cost code via its RESERVED `cost_code_id` slot, so every location's
--   progress inherits a standardized code. This is the NORMALIZATION KEY that
--   lets Phase 6 compare production rates ("420 SF/week of drywall") across
--   projects in the estimator's own language. No dollars/budgets — the code is
--   used purely as a LABEL here.
--
--   This MIRRORS the governed-dictionary pattern already shipped for location
--   sub-types (20260616_location_taxonomy.sql `subtypes`) and activities
--   (20260702_activity_dictionary.sql): the same global (cross-project) scope,
--   the same RLS shape (read = any member / write = owner·admin·pm / never anon),
--   idempotent seeding via ON CONFLICT. See:
--     - Notes/plans/Scheduling-Analytics-Slice-B-Plan.md (Phase 5, Data model)
--     - Notes/handoff/2026-07-02 - Scheduling Analytics Phase 5 Kickoff.md
--     - docs/estimate-cost-codes-catalog.md (the 227-code seed + division legend)
--
-- ADDITIVE ONLY. Nothing existing is touched: not status_logs / the activity_id
--   slot key / upsert_status_log / the audit trigger, not `activities`. It only
--   CREATES `cost_codes` and adds the FK on the ALREADY-RESERVED
--   `activity_dictionary.cost_code_id` column (created null-with-no-FK by
--   20260702). Every existing dictionary entry keeps cost_code_id = NULL.
--
-- IDEMPOTENT: safe to re-run. `create table if not exists`, guarded RLS policies,
--   guarded FK + index, and the seed uses ON CONFLICT (code) DO NOTHING so
--   re-runs + any later manual edits are preserved (re-import makes NO dupes).
--
-- OWNER-CONFIRMED DECISIONS (2026-07-03):
--   * Seed from the owner's real 227-code estimate catalog
--     (docs/estimate-cost-codes-catalog.md), full granular fidelity — nothing
--     collapsed. `code_type` (Subcontract/Material/Labor) is carried from that
--     catalog as an additive plain-TEXT label (no CHECK — matches the taxonomy
--     convention; used later to default the picker to Subcontract codes).
--   * `unit_of_measure` defaults to 'SF' (the Phase-6 rate denominator is SF via
--     units.computed_area); the catalog has no UoM, so seed rows take the default
--     and the owner can edit per code.
--   * Governance vocabulary is active/deprecated (mirrors subtypes/
--     activity_dictionary), not active/archived.
-- ============================================================

-- ============================================================
-- STEP 1: The global cost-code catalog.
--   `code`   is the granular catalog code (e.g. '09-2116.001'); UNIQUE so the
--            in-app import can upsert on conflict and the DB seed is idempotent.
--            The app normalizes (trim) before writing so re-import never dupes.
--   `division` is the 2-digit MasterFormat division (e.g. '09'); stored so the
--            manager can group without parsing (also derivable from `code`).
--   `code_type` Subcontract | Material | Labor — plain TEXT, no CHECK.
--   `unit_of_measure` default 'SF' — the quantity basis for Phase-6 rates.
--   `status` active | deprecated (CHECK) — retire obsolete codes without delete.
--   `sort_order` a stable display order (seeded by code; editable later).
-- ============================================================
CREATE TABLE IF NOT EXISTS cost_codes (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code             TEXT NOT NULL UNIQUE,
  description      TEXT,
  division         TEXT,
  code_type        TEXT,
  unit_of_measure  TEXT NOT NULL DEFAULT 'SF',
  status           TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','deprecated')),
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_by       UUID DEFAULT auth.uid(),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Grouped-list + status-filter lookups in the manager UI.
CREATE INDEX IF NOT EXISTS idx_cost_codes_division ON cost_codes (division);
CREATE INDEX IF NOT EXISTS idx_cost_codes_status   ON cost_codes (status);

-- ============================================================
-- STEP 2: RLS for cost_codes — copied VERBATIM from `subtypes` /
--   `activity_dictionary`.
--   READ  = any authenticated user who is a member of at least one project
--           (a GLOBAL catalog, not project/unit-scoped).
--   WRITE = privileged roles only (owner / admin / pm). NEVER granted to `anon`.
-- ============================================================
ALTER TABLE cost_codes ENABLE ROW LEVEL SECURITY;

-- READ: any authenticated project member
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'cost_codes'
      AND policyname = 'Members can view cost_codes'
  ) THEN
    CREATE POLICY "Members can view cost_codes"
      ON cost_codes FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM project_members pm
          WHERE pm.user_id = (SELECT auth.uid())
        )
      );
  END IF;
END
$$;

-- WRITE (INSERT): privileged roles only
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'cost_codes'
      AND policyname = 'Privileged members can insert cost_codes'
  ) THEN
    CREATE POLICY "Privileged members can insert cost_codes"
      ON cost_codes FOR INSERT
      TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM project_members pm
          WHERE pm.user_id = (SELECT auth.uid())
            AND pm.role IN ('owner','admin','pm')
        )
      );
  END IF;
END
$$;

-- WRITE (UPDATE): privileged roles only
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'cost_codes'
      AND policyname = 'Privileged members can update cost_codes'
  ) THEN
    CREATE POLICY "Privileged members can update cost_codes"
      ON cost_codes FOR UPDATE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM project_members pm
          WHERE pm.user_id = (SELECT auth.uid())
            AND pm.role IN ('owner','admin','pm')
        )
      );
  END IF;
END
$$;

-- WRITE (DELETE): privileged roles only (governance prefers status='deprecated',
-- but a hard delete is still gated to privileged roles, never anon).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'cost_codes'
      AND policyname = 'Privileged members can delete cost_codes'
  ) THEN
    CREATE POLICY "Privileged members can delete cost_codes"
      ON cost_codes FOR DELETE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM project_members pm
          WHERE pm.user_id = (SELECT auth.uid())
            AND pm.role IN ('owner','admin','pm')
        )
      );
  END IF;
END
$$;

-- ============================================================
-- STEP 3: activity_dictionary.cost_code_id → cost_codes(id).
--   The column ALREADY EXISTS (reserved by 20260702_activity_dictionary.sql with
--   no FK/table). Add the FK now, ON DELETE SET NULL so deleting/retiring a code
--   never deletes or blocks a dictionary entry. Additive; every entry starts NULL.
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'activity_dictionary_cost_code_id_fkey'
  ) THEN
    ALTER TABLE activity_dictionary
      ADD CONSTRAINT activity_dictionary_cost_code_id_fkey
      FOREIGN KEY (cost_code_id) REFERENCES cost_codes(id) ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_activity_dictionary_cost_code_id
  ON activity_dictionary (cost_code_id);

-- ============================================================
-- STEP 4: Seed the 227 codes from docs/estimate-cost-codes-catalog.md.
--   sort_order is assigned by code order (× 10, leaving gaps for manual inserts).
--   ON CONFLICT (code) DO NOTHING → re-runs + the in-app re-import add nothing.
--   This step only INSERTS into the brand-new table; it modifies no existing data.
-- ============================================================
INSERT INTO cost_codes (code, description, code_type, division, sort_order)
SELECT v.code, v.description, v.code_type, v.division,
       (row_number() OVER (ORDER BY v.code))::int * 10
FROM (VALUES
  ('01-0000.001','General Conditions','Subcontract','01'),
  ('01-0230.001','Building Permit','Subcontract','01'),
  ('01-0230.002','SAC Determination','Subcontract','01'),
  ('01-0250.001','Demolition Permit','Subcontract','01'),
  ('01-0260.001','City Licenses and Misc Permits','Subcontract','01'),
  ('01-0400.002','Supervision','Labor','01'),
  ('02-0000.001','Site Operations','Subcontract','02'),
  ('02-4100.002','Demolition','Subcontract','02'),
  ('02-9005.003','Final Cleaning','Subcontract','02'),
  ('02-9070.004','SWPPP Permit','Subcontract','02'),
  ('02-9200.005','Survey and Layout','Subcontract','02'),
  ('02-9300.006','Building and Site Services','Subcontract','02'),
  ('02-9400.007','Site Equipment','Subcontract','02'),
  ('02-9500.008','Special Inspections','Subcontract','02'),
  ('03-0000.001','Cast In-Place Concrete','Subcontract','03'),
  ('03-0000.002','Footings','Subcontract','03'),
  ('03-0000.003','Concrete Strip Footing','Subcontract','03'),
  ('03-0000.004','Concrete Fnd Pads','Subcontract','03'),
  ('03-0000.005','Concrete Walls','Subcontract','03'),
  ('03-0000.006','Concrete Columns','Subcontract','03'),
  ('03-0000.007','SOG','Subcontract','03'),
  ('03-0000.008','Under-Slab Insulation','Subcontract','03'),
  ('03-0000.009','Topping Slab on Precast Parking','Subcontract','03'),
  ('03-0000.010','Amenity Deck Topping Slab and Finished Slab','Subcontract','03'),
  ('03-0000.011','Post Tension Concrete','Subcontract','03'),
  ('03-0000.012','Concrete Patios','Material','03'),
  ('03-3543.001','Polished Concrete','Subcontract','03'),
  ('03-3543.002','Sealed Concrete','Subcontract','03'),
  ('03-4100.001','Precast Structural Concrete','Material','03'),
  ('03-4500.001','Precast Architectural Concrete','Material','03'),
  ('03-5413.001','Gypsum Cement Underlayment','Subcontract','03'),
  ('03-5413.002','Gypsum Cement (Subtract Podium Level If Pt)','Subcontract','03'),
  ('04-0000.001','Masonry','Material','04'),
  ('04-0000.002','Masonry - CMU Backup Around Building','Subcontract','04'),
  ('04-0000.003','Masonry - CMU In Garage','Subcontract','04'),
  ('04-0000.004','Masonry - Modular Brick Veneer','Subcontract','04'),
  ('04-0000.005','Masonry - Thin Brick','Subcontract','04'),
  ('04-0000.006','Masonry - Arriscraft','Subcontract','04'),
  ('04-0000.007','Masonry - PC Sill','Subcontract','04'),
  ('05-1200.001','Structural Steel','Material','05'),
  ('05-5000.001','Metal Fabrications','Subcontract','05'),
  ('05-7210.001','Aluminum Decks','Subcontract','05'),
  ('05-7210.002','Aluminum Decks - Juliette','Subcontract','05'),
  ('05-7210.003','Aluminum Decks - Railing Only Balcony','Subcontract','05'),
  ('05-7210.004','Aluminum Railings - F&I','Subcontract','05'),
  ('05-7210.005','Aluminum Decks And Railings - Installation','Subcontract','05'),
  ('06-1000.001','Rough Carpentry Materials (Loose and Joists)','Subcontract','06'),
  ('06-1010.001','Rough Carpentry Installation','Subcontract','06'),
  ('06-1710.001','Manufactured Wall Panels','Subcontract','06'),
  ('06-1753.001','Shop-Fabricated Wood Trusses','Subcontract','06'),
  ('06-1800.001','Glu-Laminated Construction','Subcontract','06'),
  ('06-2000.001','Finish Carpentry Installation','Subcontract','06'),
  ('06-2000.002','Finish Carpentry Installation - Doors','Material','06'),
  ('06-2200.003','Millwork','Subcontract','06'),
  ('06-4100.001','Architectural Casework and Millwork','Subcontract','06'),
  ('06-6113.001','Simulated Stone Fabrications','Subcontract','06'),
  ('06-6116.001','Solid Surfacing And Ctops','Subcontract','06'),
  ('06-7300.001','Composite Decking','Subcontract','06'),
  ('06-8316.001','FRP Wall Paneling','Subcontract','06'),
  ('06-8700.001','Pergolas','Subcontract','06'),
  ('07-1000.001','Waterproofing','Subcontract','07'),
  ('07-1000.002','Elevator Waterproofing','Subcontract','07'),
  ('07-1000.003','Tuckpointing','Subcontract','07'),
  ('07-1413.001','Hot-Fluid-Applied Waterproofing','Subcontract','07'),
  ('07-1413.002','Per 2" Insulation','Subcontract','07'),
  ('07-1413.003','Patios','Subcontract','07'),
  ('07-1413.004','Sky Deck','Subcontract','07'),
  ('07-1413.005','Restaurant / Commercial Patios','Subcontract','07'),
  ('07-1800.001','Traffic Coatings','Subcontract','07'),
  ('07-2100.001','Thermal Insulation','Subcontract','07'),
  ('07-2400.001','Stucco, Plaster, Eifs','Subcontract','07'),
  ('07-2500.001','Weather Barriers','Material','07'),
  ('07-2700.001','Spray-Applied Air Barriers','Material','07'),
  ('07-3113.001','Asphalt Shingles','Material','07'),
  ('07-3113.002','Gutters And Downspouts','Subcontract','07'),
  ('07-4213.001','Metal Panel Siding','Subcontract','07'),
  ('07-4600.001','Siding','Subcontract','07'),
  ('07-5000.001','Membrane Roofing','Subcontract','07'),
  ('07-6100.001','Metal Roofing','Subcontract','07'),
  ('07-6200.002','Sheet Metal Flashing','Subcontract','07'),
  ('07-7600.003','Roof Pavers','Subcontract','07'),
  ('07-8100.001','Applied Fire Proofing','Subcontract','07'),
  ('07-8400.002','Firestopping','Subcontract','07'),
  ('07-9200.003','Joint Sealants','Subcontract','07'),
  ('07-9500.004','Expansion Joints','Subcontract','07'),
  ('08-1000.001','Doors, Frames and Hardware','Material','08'),
  ('08-3000.001','Specialty Doors and Frames','Material','08'),
  ('08-3113.001','Access Doors and Panels','Material','08'),
  ('08-3613.001','Overhead and Coiling Doors','Material','08'),
  ('08-4000.001','Aluminum Entrances and Storefronts','Subcontract','08'),
  ('08-4000.002','Aluminum Storefront Doors','Material','08'),
  ('08-4400.003','Curtain Wall','Subcontract','08'),
  ('08-5113.001','Aluminum Windows and Patio Doors','Material','08'),
  ('08-5413.001','Windows and Patio Doors','Material','08'),
  ('08-5413.002','Windows and Patio Doors - Installation','Material','08'),
  ('08-6000.001','Roof Windows and Skylights','Material','08'),
  ('08-8000.002','Glazing','Subcontract','08'),
  ('08-8330.003','Mirrors','Subcontract','08'),
  ('08-8330.004','Mirrors - Residential','Subcontract','08'),
  ('08-8700.001','Window Film','Material','08'),
  ('08-9000.001','Louvers and Vents','Subcontract','08'),
  ('09-2116.001','Gypsum Board Assemblies','Subcontract','09'),
  ('09-2216.002','Steel Stud Metal Framing','Material','09'),
  ('09-3000.001','Tile','Subcontract','09'),
  ('09-5123.001','Acoustical Ceilings','Subcontract','09'),
  ('09-6400.001','Wood Flooring','Subcontract','09'),
  ('09-6500.001','Resilient Flooring','Subcontract','09'),
  ('09-6600.001','Terrazzo Flooring','Subcontract','09'),
  ('09-6800.001','Carpeting','Subcontract','09'),
  ('09-7200.001','Wall Coverings','Subcontract','09'),
  ('09-9000.001','Painting','Subcontract','09'),
  ('09-9000.002','Painting - Exterior','Subcontract','09'),
  ('09-9646.001','Intumescent Painting','Subcontract','09'),
  ('09-9656.001','Epoxy Flooring','Subcontract','09'),
  ('10-0000.001','Specialties','Subcontract','10'),
  ('10-1400.001','Signage','Subcontract','10'),
  ('10-1400.002','Signage - Exterior Building, Retail, Restaurant','Subcontract','10'),
  ('10-1400.003','Signage - Monument Sign','Subcontract','10'),
  ('10-1453.001','Traffic Signage','Subcontract','10'),
  ('10-2113.001','Toilet Partitions','Subcontract','10'),
  ('10-2213.002','Wire Mesh Storage Cages','Subcontract','10'),
  ('10-2226.001','Operable Partitions','Subcontract','10'),
  ('10-2600.001','Wall and Door Protection','Material','10'),
  ('10-2800.001','Toilet and Bath Accessories','Subcontract','10'),
  ('10-2819.001','Tub and Shower Doors','Material','10'),
  ('10-3100.001','Manufactured Fireplaces - Commons','Subcontract','10'),
  ('10-3110.002','Outdoor Fire Pits','Material','10'),
  ('10-4413.001','Fire Extinguishers and Cabinets','Subcontract','10'),
  ('10-5100.001','Lockers','Subcontract','10'),
  ('10-5500.001','Postal Specialties','Subcontract','10'),
  ('10-5500.002','Package Concierge','Subcontract','10'),
  ('10-5623.001','Closet Shelving','Subcontract','10'),
  ('10-7313.001','Awnings and Canopies','Subcontract','10'),
  ('10-7500.001','Flagpoles','Subcontract','10'),
  ('10-9000.001','Golf Simulator','Subcontract','10'),
  ('11-1313.001','Loading Dock Equip','Subcontract','11'),
  ('11-2423.001','Window Washing System','Material','11'),
  ('11-3100.001','Appliances','Subcontract','11'),
  ('11-3110.001','Outdoor Gas Grill','Material','11'),
  ('11-4000.001','Food Service Equipment','Subcontract','11'),
  ('11-6700.001','Recreational Equipment','Subcontract','11'),
  ('11-8216.001','Trash Compactors','Subcontract','11'),
  ('12-2000.001','Window Treatments','Material','12'),
  ('12-3530.001','Residential Casework - Material','Material','12'),
  ('12-3530.002','Residential Casework - Installation','Subcontract','12'),
  ('12-3570.001','Healthcare Casework and FFE','Subcontract','12'),
  ('12-3640.001','Residential Countertops','Subcontract','12'),
  ('12-3663.001','Window Sills','Material','12'),
  ('12-4000.001','Furnishings and Accessories','Subcontract','12'),
  ('12-4813.001','Entrance Floor Mats and Frames','Subcontract','12'),
  ('12-9313.001','Bike Equipment and Racks','Subcontract','12'),
  ('13-1100.001','Swimming Pool','Subcontract','13'),
  ('13-1100.002','Spa','Subcontract','13'),
  ('13-1900.001','Pet Equipment','Subcontract','13'),
  ('13-2416.001','Saunas','Subcontract','13'),
  ('13-3418.001','Post Frame Building Systems','Subcontract','13'),
  ('14-0000.001','Conveying Equipment','Subcontract','14'),
  ('14-2000.001','Elevators','Subcontract','14'),
  ('14-4200.001','Wheelchair Lifts','Subcontract','14'),
  ('14-9182.001','Trash Chute','Subcontract','14'),
  ('21-0000.001','Fire Suppression System','Subcontract','21'),
  ('21-0000.002','Fire Pump','Subcontract','21'),
  ('22-0000.001','Plumbing','Subcontract','22'),
  ('22-0000.002','Plumbing - Fixtures','Subcontract','22'),
  ('22-0000.003','Domestic Water Pump','Subcontract','22'),
  ('22-4129.001','Shower Pans','Subcontract','22'),
  ('23-0000.001','HVAC','Subcontract','23'),
  ('26-0000.001','Electrical','Subcontract','26'),
  ('26-0000.002','Electrical - Fixtures','Subcontract','26'),
  ('26-0000.003','Electrical - EV Charging','Subcontract','26'),
  ('26-0000.004','Electrical - Site Lighting','Subcontract','26'),
  ('26-0000.005','Electrical - Fire Pump Wiring','Subcontract','26'),
  ('26-0000.006','Electrical - Generator','Subcontract','26'),
  ('27-2000.001','Data Communications','Subcontract','27'),
  ('27-4000.001','Audio-Video Communications','Subcontract','27'),
  ('28-1300.001','Access Control','Subcontract','28'),
  ('28-3000.001','Video Surveillance','Subcontract','28'),
  ('28-4600.001','Fire Detection And Alarm','Subcontract','28'),
  ('28-9010.001','Radio Amplification System','Subcontract','28'),
  ('31-0000.001','Earthwork','Subcontract','31'),
  ('31-2113.001','Radon Mitigation','Subcontract','31'),
  ('31-2500.001','Erosion Control','Subcontract','31'),
  ('31-4000.001','Shoring','Subcontract','31'),
  ('31-6000.001','Piles, Piers And Caissons','Subcontract','31'),
  ('32-1216.001','Asphalt Paving','Subcontract','32'),
  ('32-1216.002','Asphalt Paving - Light Duty','Subcontract','32'),
  ('32-1216.003','Asphalt Paving - Heavy Duty','Subcontract','32'),
  ('32-1313.001','Concrete Paving','Material','32'),
  ('32-1316.001','Decorative Concrete Paving','Material','32'),
  ('32-1343.001','Pervious Concrete Paving','Material','32'),
  ('32-1400.001','Unit Pavers','Subcontract','32'),
  ('32-1613.001','Site Concrete','Material','32'),
  ('32-1613.002','Surmountable Curb','Subcontract','32'),
  ('32-1613.003','B612 Curb','Subcontract','32'),
  ('32-1613.004','Cross Gutter','Subcontract','32'),
  ('32-1613.005','Light Duty Concrete','Material','32'),
  ('32-1613.006','Heavy Duty Concrete','Material','32'),
  ('32-1613.007','Concrete Curb Stops','Material','32'),
  ('32-1700.001','Pavement Markings','Subcontract','32'),
  ('32-1813.001','Artificial Turf','Subcontract','32'),
  ('32-3100.001','Fences and Gates','Subcontract','32'),
  ('32-3200.001','Retaining Walls','Subcontract','32'),
  ('32-9000.001','Landscaping And Irrigation','Subcontract','32'),
  ('33-0000.001','Utilities','Subcontract','33'),
  ('33-0000.002','Water','Subcontract','33'),
  ('33-0000.003','Sanitary','Subcontract','33'),
  ('33-0000.004','Sanitary - Structure','Subcontract','33'),
  ('33-0000.005','Storm - 6" - 10"','Subcontract','33'),
  ('33-0000.006','Storm - 12" - 18"','Subcontract','33'),
  ('33-0000.007','Storm - 24" - 36"','Subcontract','33'),
  ('33-0000.008','Storm - 42" - 60"','Subcontract','33'),
  ('33-0000.009','Storm - Structure','Subcontract','33'),
  ('33-0000.010','Storm - UG Retention','Subcontract','33'),
  ('50-2000.001','Winter Conditions','Subcontract','50'),
  ('50-2000.002','Temp Enclosures','Subcontract','50'),
  ('50-2000.003','Temp Heaters','Subcontract','50'),
  ('50-2000.004','Temp Gas','Subcontract','50'),
  ('50-2000.005','Wiring for Temp Heaters','Subcontract','50'),
  ('50-2000.006','Temp Gas Piping','Subcontract','50'),
  ('50-2000.007','Poly Windows','Material','50'),
  ('50-2000.008','Snow Removal','Subcontract','50'),
  ('80-8001.001','TBD','Subcontract','80'),
  ('80-8002.002','TBD','Subcontract','80'),
  ('80-8003.003','TBD','Subcontract','80'),
  ('80-8004.004','TBD','Subcontract','80'),
  ('80-8005.005','TBD','Subcontract','80'),
  ('80-8006.006','TBD','Subcontract','80')
) AS v(code, description, code_type, division)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- STEP 5: Documentation comments (idempotent; catalog metadata only).
-- ============================================================
COMMENT ON TABLE cost_codes IS
  'Global, company-wide cost-code catalog (cross-project). CSI MasterFormat codes '
  'used purely as normalization LABELS (no dollars/budgets). A canonical activity '
  'points here via activity_dictionary.cost_code_id. Mirrors the governed-'
  'dictionary RLS pattern of `subtypes`/`activity_dictionary` (read=member, '
  'write=owner/admin/pm, never anon). Seeded from docs/estimate-cost-codes-catalog.md.';
COMMENT ON COLUMN cost_codes.code IS
  'Granular catalog code (e.g. ''09-2116.001''). UNIQUE — enables idempotent '
  'import upsert (onConflict=code) and DB seed (ON CONFLICT DO NOTHING).';
COMMENT ON COLUMN cost_codes.division IS
  '2-digit MasterFormat division (e.g. ''09''). Stored for grouping; also derivable from `code`.';
COMMENT ON COLUMN cost_codes.code_type IS
  'Estimate line-item kind: ''Subcontract'' | ''Material'' | ''Labor''. Plain TEXT '
  '(no CHECK), from the source catalog; used to default the picker to Subcontract codes.';
COMMENT ON COLUMN cost_codes.unit_of_measure IS
  'Quantity basis for Phase-6 production rates (default ''SF'', matching units.computed_area).';
COMMENT ON COLUMN cost_codes.status IS
  'Governance status: ''active'' | ''deprecated'' (retire without delete).';
COMMENT ON COLUMN activity_dictionary.cost_code_id IS
  'Optional FK → cost_codes(id), ON DELETE SET NULL (was RESERVED by 20260702). '
  'NULL = the canonical activity is not stamped with a cost code yet.';

-- ============================================================
-- VERIFICATION (run after applying; read-only — NOT part of the migration):
--
--   -- table + RLS + seed present:
--   SELECT to_regclass('public.cost_codes');                              -- public.cost_codes
--   SELECT relrowsecurity FROM pg_class WHERE relname='cost_codes';       -- true
--   SELECT count(*) FROM cost_codes;                                      -- 227
--   SELECT count(*) FROM cost_codes WHERE status='active';                -- 227
--   SELECT count(DISTINCT division) FROM cost_codes;                      -- 25 divisions
--
--   -- idempotency: re-running the whole file adds nothing (still 227).
--
--   -- FK on the reserved slot (was column-only):
--   SELECT conname FROM pg_constraint WHERE conname='activity_dictionary_cost_code_id_fkey'; -- 1 row
--   SELECT count(*) FROM activity_dictionary WHERE cost_code_id IS NOT NULL;  -- 0 (nothing linked yet)
--
--   -- RLS shape mirrors subtypes (read=member, writes=owner/admin/pm, TO authenticated):
--   SELECT policyname, cmd, roles FROM pg_policies
--     WHERE tablename='cost_codes' ORDER BY policyname;                   -- 4 policies, {authenticated}
-- ============================================================
