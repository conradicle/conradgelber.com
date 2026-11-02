import importlib.util, unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('hurdat',Path(__file__).resolve().parents[1]/'scripts/fetch-hurricanes.py')
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
class Hurricanes(unittest.TestCase):
 def test_latest(self):
  self.assertEqual(h.latest('hurdat2-1851-2025-02272026.txt hurdat2-1851-2025-092326.txt hurdat2-nepac-1949-2026-100126.txt'),'hurdat2-1851-2025-092326.txt')
 def test_parser_missing_and_landfall(self):
  s=h.parse('AL011999, TEST, 2,\n19990101, 0000, , TS, 25.0N, 81.0W, 40, -999,\n19990101, 0600, L, HU, 26.0N, 79.0W, 64, 990,')[0]
  self.assertEqual(s['points'][0]['lon'],-81);self.assertIsNone(s['points'][0]['pressure']);self.assertEqual(s['points'][1]['record'],'L');self.assertEqual(s['peakCategory'],1)
  self.assertLess(s['closest']['miles'],min(h.distance(p['lat'],p['lon']) for p in s['points']))
