CREATE TABLE questions (id INTEGER PRIMARY KEY, week TEXT NOT NULL, text TEXT NOT NULL, choices TEXT NOT NULL, answer INTEGER NOT NULL);
CREATE TABLE attempts (id INTEGER PRIMARY KEY, week TEXT NOT NULL, student TEXT NOT NULL, score INTEGER NOT NULL, at INTEGER NOT NULL);
INSERT INTO questions (week, text, choices, answer) VALUES
  ('2026-W47', 'What is the chemical symbol for water?', '["H2O","O2","CO2","NaCl"]', 0),
  ('2026-W47', 'Which planet is closest to the Sun?', '["Venus","Earth","Mercury","Mars"]', 2),
  ('2026-W47', 'What force keeps us on the ground?', '["Magnetism","Gravity","Friction","Inertia"]', 1),
  ('2026-W47', 'What gas do plants take in?', '["Oxygen","Nitrogen","Carbon dioxide","Helium"]', 2);
