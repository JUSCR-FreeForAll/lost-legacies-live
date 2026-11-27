import unittest
from interop import parse, validate_health

class ContractTests(unittest.TestCase):
    def setUp(self):
        self.good = dict(status="READY", service="phoenix-fortress", chain_height=2, tip_hash="a"*64, ledger_sync=True)
    def test_ready(self):
        self.assertEqual(validate_health(self.good, 2, "A"*64), self.good)
    def test_bad_envelopes(self):
        for raw in ("[]", "null", "true", "{", '{"a":1,"a":2}', '{"a":NaN}'):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                parse(raw)
    def test_bad_health(self):
        for key, value in (("status","DEGRADED"),("chain_height",True),("chain_height",-1),("tip_hash","bad"),("ledger_sync",False),("service","other")):
            with self.subTest(key=key), self.assertRaises(ValueError):
                validate_health(dict(self.good, **{key:value}))
    def test_checkpoint(self):
        with self.assertRaises(ValueError):
            validate_health(self.good, 3)
        with self.assertRaises(ValueError):
            validate_health(self.good, 0, "b"*64)
