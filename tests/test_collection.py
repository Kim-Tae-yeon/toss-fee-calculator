import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'local-client'))
from fee_tool import TossClient, DataError


class CollectionEvidenceTests(unittest.TestCase):
    def test_only_completed_pagination_produces_evidence(self):
        client = TossClient('fixture', 'fixture')
        pages = [
            {'access_token': 'fixture'}, [{'accountSeq': 1}],
            {'orders': [], 'hasNext': True, 'nextCursor': 'page2'},
            {'orders': [], 'hasNext': False, 'nextCursor': None},
            {'orders': [], 'hasNext': False, 'nextCursor': None},
        ]
        with patch.object(client, '_request', side_effect=pages):
            report = client.collect()
        self.assertEqual([g['pages'] for g in report['retrieval']['groups']], [2, 1])
        self.assertTrue(report['retrieval']['allReturnedAccountsProcessed'])
        self.assertFalse(report['lifetimeVerified'])

    def test_partial_download_does_not_claim_completion(self):
        client = TossClient('fixture', 'fixture')
        with patch.object(client, '_request', side_effect=[
            {'access_token': 'fixture'}, [{'accountSeq': 1}],
            {'orders': [], 'hasNext': True, 'nextCursor': 'page2'},
            DataError('later page failed'),
        ]), self.assertRaises(DataError):
            client.collect()


if __name__ == '__main__':
    unittest.main()
