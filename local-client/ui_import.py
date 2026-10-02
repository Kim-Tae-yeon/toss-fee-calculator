"""Parse locally observed Toss transaction detail text; never infer missing fees."""
import hashlib
import re
from decimal import Decimal
from collections import defaultdict
from fee_tool import DataError, analyze, decimal, money


def analyze_observations(payload):
    observations = payload.get('observations')
    if not isinstance(observations, list) or not observations:
        raise DataError('수집한 거래 내역이 없습니다.')
    orders, seen, evidence = [], {}, []
    for item in observations:
        currency = item.get('currency')
        lines = [s.strip() for s in item.get('detail', '').splitlines() if s.strip()]
        if currency not in ('KRW', 'USD') or len(lines) < 8:
            raise DataError('거래 상세 형식을 확인하세요.')
        def value(label):
            return lines[lines.index(label)+1] if label in lines and lines.index(label)+1 < len(lines) else None
        def amount(label):
            raw = value(label)
            if raw is None:
                return None
            if (currency == 'KRW' and not raw.endswith('원')) or (currency == 'USD' and not raw.startswith('$')):
                raise DataError('금액 통화가 일치하지 않습니다.')
            return money(decimal(raw.replace(',', '').replace('원', '').replace('$', ''), label))
        kind = value('거래유형')
        if kind not in ('주식구매', '주식판매'):
            raise DataError('현재 화면 가져오기는 주식 매매 내역만 지원합니다.')
        buy = kind == '주식구매'
        def day(label):
            match = re.fullmatch(r'(\d{4})년 (\d{1,2})월 (\d{1,2})일', value(label) or '')
            if not match:
                raise DataError('거래 날짜가 없습니다.')
            y, m, d = map(int, match.groups())
            return f'{y:04d}-{m:02d}-{d:02d}'
        date = day('구매일' if buy else '판매일')
        settlement = day('출금일' if buy else '입금일')
        identity = (currency, lines[0], kind, date, settlement)
        if currency == 'USD':
            # US details are individual ledger entries, including multiple same-day trades.
            # Equal fee/amount/date does not mean a duplicate transaction.
            if not isinstance(item.get('index'), int) or not item.get('row'):
                raise DataError('해외주식은 거래 목록 행 번호와 원문이 필요합니다.')
            net = lambda s: decimal(s.replace(',', '').replace('$', ''), '거래금액')
            if net(item['row'].strip().splitlines()[-2]) != net(lines[1]):
                raise DataError('목록과 상세 금액이 다릅니다. 로딩 후 다시 수집하세요.')
            identity += (str(item['index']),)
        values = (amount('수수료'), amount('제세금'), amount('총 구매금액' if buy else '총 판매금액'), lines[1])
        if identity in seen and seen[identity] != values:
            raise DataError('같은 날짜·종목의 합산 내역이 서로 다릅니다. 원본 확인이 필요합니다.')
        seen[identity] = values
        key = hashlib.sha256('|'.join(identity).encode()).hexdigest()[:20]
        orders.append({'orderId': key, 'currency': currency, 'symbol': lines[0],
                       'side': 'BUY' if buy else 'SELL', 'status': 'UI_GROUP',
                       'execution': {'filledQuantity': '1', 'commission': values[0],
                                     'tax': values[1], 'filledAt': date+'T00:00:00+09:00',
                                     'settlementDate': settlement}})
        evidence.append(item)
    report = analyze([{'accountSeq':'observed-basic', 'label':'기본계좌', 'orders':orders}])
    report.update(source='Toss Securities 거래 상세 화면', lifetimeVerified=False,
                  limitation='거래 화면에서 확인한 매매 수수료입니다. 국내주식 합산 상세는 중복 제거하고, 해외주식은 각 거래 행을 개별 집계합니다. 다른 계좌·환전·이자는 별도이며 거래내역서 대조 전입니다.',
                  observationCount=len(evidence))
    for row in report['rows']:
        row['filledQuantity'] = ''  # UI detail is a daily aggregate, not one share/order.
    fx_rows, fx_seen = [], set()
    for item in payload.get('fxObservations', []):
        lines = [s.strip() for s in item.get('detail', '').splitlines() if s.strip()]
        if len(lines) < 6 or not isinstance(item.get('index'), int):
            raise DataError('환전 상세 내역이 불완전합니다.')
        match = re.search(r'환전 수수료\s+([\d,]+)원', item['detail'])
        if not match:
            raise DataError('환전 수수료가 표시되지 않은 내역입니다.')
        if decimal(item['row'].strip().splitlines()[-2].replace(',','').replace('원',''), '원화') != decimal(lines[1].replace(',','').replace('원',''), '원화'):
            raise DataError('환전 목록과 상세 금액이 다릅니다. 다시 확인하세요.')
        date = lines[lines.index('일시')+1]
        identity = (item['index'], date)
        if identity in fx_seen:
            raise DataError('중복 환전 행입니다.')
        fx_seen.add(identity)
        fx_rows.append({'index':item['index'], 'date':date, 'kind':lines[0], 'commission':match[1].replace(',','')})
    report['fx'] = {'currency':'KRW','count':len(fx_rows), 'commission':money(sum((Decimal(r['commission']) for r in fx_rows),Decimal(0))), 'rows':fx_rows}
    report['knownFees'] = {currency: bucket['commission'] for currency,bucket in report['totals'].items()}
    if fx_rows:
        report['knownFees']['KRW'] = money(Decimal(report['knownFees'].get('KRW','0'))+Decimal(report['fx']['commission']))
    report['listCoverageVerified'] = False
    expected = (payload.get('krListRows'), payload.get('usListRows'), payload.get('fxListRows'))
    if all(isinstance(n, int) and n >= 0 for n in expected):
        collections = ([x for x in observations if x['currency']=='KRW'],
                       [x for x in observations if x['currency']=='USD'], payload.get('fxObservations', []))
        for items, count in zip(collections, expected):
            indices = [x.get('index') for x in items]
            if len(indices) != count or set(indices) != set(range(count)):
                raise DataError('거래 목록에 누락 또는 중복 행이 있습니다.')
        groups = defaultdict(list)
        for item in collections[0]:
            lines = [s.strip() for s in item['detail'].splitlines() if s.strip()]
            groups[tuple(lines[:8])].append(item)
        for key, items in groups.items():
            net = lambda s: decimal(s.replace(',','').replace('원',''), '국내주식 금액')
            if sum((net(x['row'].strip().splitlines()[-2]) for x in items),Decimal(0)) != net(key[1]):
                raise DataError('국내주식 목록 합계와 상세 합계가 다릅니다.')
        report['listCoverageVerified'] = True
        report['listCounts'] = dict(zip(('KRW','USD','FX'), expected))
        report['limitation'] = '기본계좌의 조회된 주식·환전 목록 전체를 확인하고 목록 금액과 상세 금액을 대조했습니다. 세금·대출이자·별도 이체 비용은 수수료 합계에서 제외합니다. 거래내역서 대조 전이며 해지된 계좌는 포함되지 않습니다.'
    return report
