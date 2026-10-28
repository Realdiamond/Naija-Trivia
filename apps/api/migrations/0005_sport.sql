-- Sport becomes the sixth category (doc 04 §1). It starts switched off, so duels never offer it
-- before approved sport questions are live; switch it on with
--   UPDATE categories SET active = true WHERE id = 'sport';
-- Mixed Naija moves to the end of the list.
INSERT INTO categories (id, name_en, name_pcm, emoji, color_hex, sort_order, active) VALUES
 ('sport', 'Sport', 'Sport', '⚽', '#B8860B', 5, false);
UPDATE categories SET sort_order = 6 WHERE id = 'mixed';
