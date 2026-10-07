"""Historical indicative valuation, never a claim of actual KRW cash paid."""
from datetime import datetime
from decimal import Decimal, localcontext, ROUND_HALF_UP


def add_reference_rates(report, request, progress=lambda _: None):
    with localcontext() as context:
        context.prec = 80
        _add(report, request, progress)
    return report


def _add(report, request, progress):
    cache, missing, errors = {}, [], []
    converted = Decimal(0)
    consecutive_failures = 0
    usd_rows = [r for r in report['rows'] if r['currency'] == 'USD']
    for index, row in enumerate(usd_rows, 1):
        fee, stamp = row.get('commission'), row.get('filledAt')
        if fee is None:
            missing.append(row['orderId'])
            row['referenceIssue'] = '원본 주문의 수수료 금액이 비어 있어 환산 불가'
            errors.append({'orderId': row['orderId'], 'reason': row['referenceIssue']})
            continue
        if Decimal(fee) == 0:
            row['referenceKrw'] = '0'
            continue
        try:
            failure_reason = '과거 환율 조회가 3회 연속 실패하여 추가 요청을 중단함'
            if consecutive_failures >= 3:
                raise ValueError('Repeated rate lookup failures; no further requests')
            failure_reason = '최종 체결시각이 없거나 시간대 형식이 올바르지 않음'
            when = datetime.fromisoformat(stamp.replace('Z', '+00:00'))
            if when.tzinfo is None:
                raise ValueError('timezone required')
            if stamp not in cache:
                failure_reason = '해당 시각의 환율 API 요청 실패: 자료 부재·접근 제한·연결 오류 여부 확인 필요'
                data = request('/api/v1/exchange-rate', query={
                    'baseCurrency': 'USD', 'quoteCurrency': 'KRW', 'dateTime': stamp})
                failure_reason = '환율 응답의 통화·유효 시간·숫자 형식 검증 실패'
                if not isinstance(data['rate'], str):
                    raise ValueError('exact decimal rate string required')
                rate = Decimal(data['rate'])
                start = datetime.fromisoformat(data['validFrom'].replace('Z', '+00:00'))
                end = datetime.fromisoformat(data['validUntil'].replace('Z', '+00:00'))
                if (data['baseCurrency'] != 'USD' or data['quoteCurrency'] != 'KRW'
                        or not rate.is_finite() or rate <= 0 or rate >= Decimal('1000000') or rate.as_tuple().exponent < -8
                        or not start.tzinfo or not end.tzinfo or not start <= when < end):
                    raise ValueError('invalid rate window')
                cache[stamp] = rate
            value = Decimal(fee) * cache[stamp]
            converted += value
            consecutive_failures = 0
            row.update(referenceRate=format(cache[stamp], 'f'), rateDate=stamp,
                       referenceKrw=format(value, 'f'),
                       evidence='Toss Open API /api/v1/exchange-rate; 최종 체결시각의 참고 환율, 실제 환전 원가 아님')
        except (ValueError, TypeError, KeyError, ArithmeticError):
            consecutive_failures += 1
            missing.append(row['orderId'])
            row['referenceIssue'] = failure_reason + ' · 대체 환율 미적용'
            errors.append({'orderId': row['orderId'], 'reason': row['referenceIssue']})
        progress(f'과거 참고 환율 {index}/{len(usd_rows)}건 확인 중 (실제 원화 지출과 구분)')
    krw = report.get('totals', {}).get('KRW', {}).get('commission')
    total = converted + Decimal(krw or '0')
    missing_fees = sum(t.get('missingCommission', 0) for t in report.get('totals', {}).values())
    complete = not missing and not missing_fees
    report['referenceConversion'] = {
        'basis': '최종 체결시각의 참고 환율. 주문별 여러 체결의 가중 환율·실제 원화 출금액이 아님.',
        'usdFeesKrw': format(converted, 'f'), 'knownKrwFees': krw or '0',
        'combinedKrw': format(total, 'f'),
        'roundedKrw': format(total.quantize(Decimal('1'), rounding=ROUND_HALF_UP), 'f') if complete else None,
        'complete': complete, 'actualPaidKrwVerified': False,
        'missingCount': len(missing), 'issues': errors,
    }
