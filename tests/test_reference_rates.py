import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"local-client"))
import unittest
from copy import deepcopy
from reference_rates import add_reference_rates

def report():
    return {'rows':[{'orderId':'a','currency':'USD','commission':'0.1','filledAt':'2025-01-02T12:00:30+09:00'}],
            'totals':{'KRW':{'commission':'10','missingCommission':0},'USD':{'commission':'0.1','missingCommission':0}}}

def response(*args,**kwargs):
    return {'baseCurrency':'USD','quoteCurrency':'KRW','rate':'1300.25',
            'validFrom':'2025-01-02T12:00:00+09:00','validUntil':'2025-01-02T12:01:00+09:00'}

class RateTests(unittest.TestCase):
    def test_exact_historical_value_and_no_actual_cash_claim(self):
        r=add_reference_rates(report(),response)
        self.assertEqual(r['referenceConversion']['combinedKrw'],'140.025')
        self.assertEqual(r['referenceConversion']['roundedKrw'],'140')
        self.assertFalse(r['referenceConversion']['actualPaidKrwVerified'])
        self.assertEqual(r['rows'][0]['referenceRate'],'1300.25')

    def test_wrong_window_and_currency_fail_closed(self):
        for change in [{'validFrom':'2026-01-02T12:00:00+09:00'},{'quoteCurrency':'USD'},{'rate':'NaN'}]:
            r=add_reference_rates(report(),lambda *a,**k:{**response(),**change})
            self.assertFalse(r['referenceConversion']['complete'])
            self.assertNotIn('referenceRate',r['rows'][0])

    def test_zero_fee_does_not_need_rate(self):
        r=report();r['rows'][0]['commission']='0'
        add_reference_rates(r,lambda *a,**k:self.fail('Zero fee should not request a rate'))
        self.assertTrue(r['referenceConversion']['complete'])

    def test_missing_fee_and_endpoint_failure_are_not_zero(self):
        r=report();r['rows'][0]['commission']=None
        add_reference_rates(r,response)
        self.assertFalse(r['referenceConversion']['complete'])
        def fail(*a,**k):raise ValueError('rate unavailable')
        r=add_reference_rates(report(),fail)
        self.assertIsNone(r['referenceConversion']['roundedKrw'])

    def test_same_timestamp_cached_and_refund_keeps_sign(self):
        r=report();r['rows'].append({**r['rows'][0],'orderId':'b','commission':'-0.05'})
        calls=[]
        def fetch(*a,**k):calls.append(k);return response()
        add_reference_rates(r,fetch)
        self.assertEqual(len(calls),1)
        self.assertEqual(calls[0]['query']['dateTime'],'2025-01-02T12:00:30+09:00')
        self.assertEqual(r['referenceConversion']['usdFeesKrw'],'65.0125')

if __name__=='__main__':unittest.main()
