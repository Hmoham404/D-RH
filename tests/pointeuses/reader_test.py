import importlib.util
from datetime import date, datetime
from pathlib import Path
from types import SimpleNamespace
import unittest

spec = importlib.util.spec_from_file_location('reader', Path(__file__).resolve().parents[2] / 'scripts' / 'read-pointeuses.py')
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)
DEVICE = {'name': 'Fixture', 'host': '10.10.100.201', 'port': 4370}


class ReaderTest(unittest.TestCase):
    def test_only_attendance_fields_are_exported_and_session_is_closed(self):
        calls = []
        class Clock:
            def connect(self):
                calls.append('connect')
                return self
            def get_attendance(self):
                calls.append('attendance')
                return [SimpleNamespace(user_id='003', timestamp=datetime(2026, 10, day, 0, 15, 19), status=1, punch=0)
                        for day in (1, 2, 3)]
            def disconnect(self):
                calls.append('disconnect')
        def factory(host, **options):
            self.assertEqual(host, DEVICE['host'])
            self.assertTrue(options['ommit_ping'])
            self.assertFalse(options['verbose'])
            return Clock()
        device, records = reader.read_device(DEVICE, date(2026, 10, 2), date(2026, 10, 2), 3, factory)
        self.assertTrue(device['connected'])
        self.assertEqual(records[0]['timestamp'], '2026-10-02T00:15:19')
        self.assertEqual(records[0]['userId'], '003')
        self.assertEqual(set(records[0]), {'userId', 'timestamp', 'terminal', 'host', 'verification', 'punch'})
        self.assertEqual(calls, ['connect', 'attendance', 'disconnect'])

    def test_read_failure_closes_session_and_returns_no_partial_records(self):
        calls = []
        class Clock:
            def connect(self): return self
            def get_attendance(self): raise RuntimeError('transport stopped')
            def disconnect(self): calls.append('disconnect')
        device, records = reader.read_device(DEVICE, date(2026, 10, 1), date(2026, 10, 2), 3, lambda *a, **kw: Clock())
        self.assertFalse(device['connected'])
        self.assertEqual(records, [])
        self.assertEqual(calls, ['disconnect'])


if __name__ == '__main__':
    unittest.main()
