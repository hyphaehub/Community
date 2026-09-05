-- HypheaHub global preset strains (workspace_id NULL, is_preset = 1).
-- Neutral, species-agnostic catalog of common gourmet + functional cultivars.
-- Idempotent: safe to run multiple times.
INSERT OR IGNORE INTO strains
  (id, workspace_id, common_name, species, category, vendor,
   optimal_temp_min_c, optimal_temp_max_c, is_preset, notes, created_at, updated_at)
VALUES
  ('preset_oyster_blue',   NULL, 'Blue Oyster',      'Pleurotus ostreatus var. columbinus', 'GOURMET',    NULL, 10, 21, 1, NULL, 1735689600000, 1735689600000),
  ('preset_oyster_pearl',  NULL, 'Pearl Oyster',     'Pleurotus ostreatus',                 'GOURMET',    NULL, 15, 24, 1, NULL, 1735689600000, 1735689600000),
  ('preset_oyster_pink',   NULL, 'Pink Oyster',      'Pleurotus djamor',                    'GOURMET',    NULL, 20, 30, 1, NULL, 1735689600000, 1735689600000),
  ('preset_oyster_gold',   NULL, 'Golden Oyster',    'Pleurotus citrinopileatus',           'GOURMET',    NULL, 21, 29, 1, NULL, 1735689600000, 1735689600000),
  ('preset_oyster_king',   NULL, 'King Oyster',      'Pleurotus eryngii',                   'GOURMET',    NULL, 15, 21, 1, NULL, 1735689600000, 1735689600000),
  ('preset_lions_mane',    NULL, 'Lion''s Mane',     'Hericium erinaceus',                  'FUNCTIONAL', NULL, 18, 24, 1, NULL, 1735689600000, 1735689600000),
  ('preset_shiitake',      NULL, 'Shiitake',         'Lentinula edodes',                    'GOURMET',    NULL, 15, 21, 1, NULL, 1735689600000, 1735689600000),
  ('preset_reishi',        NULL, 'Reishi',           'Ganoderma lucidum',                   'FUNCTIONAL', NULL, 21, 27, 1, NULL, 1735689600000, 1735689600000),
  ('preset_turkey_tail',   NULL, 'Turkey Tail',      'Trametes versicolor',                 'FUNCTIONAL', NULL, 18, 24, 1, NULL, 1735689600000, 1735689600000),
  ('preset_chestnut',      NULL, 'Chestnut',         'Pholiota adiposa',                    'GOURMET',    NULL, 13, 18, 1, NULL, 1735689600000, 1735689600000),
  ('preset_maitake',       NULL, 'Maitake',          'Grifola frondosa',                    'GOURMET',    NULL, 13, 18, 1, NULL, 1735689600000, 1735689600000),
  ('preset_enoki',         NULL, 'Enoki',            'Flammulina velutipes',                'GOURMET',    NULL, 10, 15, 1, NULL, 1735689600000, 1735689600000),
  ('preset_wine_cap',      NULL, 'Wine Cap',         'Stropharia rugosoannulata',           'GOURMET',    NULL, 18, 27, 1, NULL, 1735689600000, 1735689600000),
  ('preset_cordyceps',     NULL, 'Cordyceps',        'Cordyceps militaris',                 'FUNCTIONAL', NULL, 18, 23, 1, NULL, 1735689600000, 1735689600000),
  ('preset_nameko',        NULL, 'Nameko',           'Pholiota microspora',                 'GOURMET',    NULL, 10, 16, 1, NULL, 1735689600000, 1735689600000);
