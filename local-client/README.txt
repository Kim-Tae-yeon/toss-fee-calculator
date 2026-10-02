내 수수료 계산기 - Windows 공식 API 조회 도구

1. ZIP을 풀고 TossFeeAnalyzer.exe를 실행합니다.
2. 브라우저가 자동으로 열립니다. 열리지 않으면 실행 창의 127.0.0.1 주소를 복사합니다.
3. 본인의 토스증권 Open API Client ID와 Client Secret을 입력합니다.
4. 전체 기간 조회 후 결과를 확인하거나 거래별 CSV를 저장합니다.
5. 실행 창을 닫으면 프로그램이 종료됩니다.

Python을 별도로 설치할 필요가 없습니다. macOS/Linux에서는 소스의 launch.py를 Python 3.10 이상으로 실행할 수 있습니다.

Open API 사용 신청·키 발급·허용 IP 설정은 공식 안내를 확인하세요:
https://developers.tossinvest.com/docs

토스 PC 웹 로그인만으로는 API 인증이 되지 않습니다.
동일 키로 새 토큰을 발급하면 해당 키의 기존 토큰은 무효화될 수 있습니다.
키는 메모리에서 토스 공식 인증 서버에만 사용하며 계좌/주문 조회만 합니다.
개인 제작 도구이며 토스증권 공식 서비스가 아닙니다. 실행 파일은 코드 서명되지 않았습니다.

조회 범위: API가 반환하는 국내·미국 주식 주문의 실제 commission.
환전, 해지/휴면 계좌, API 미지원 주문, 별도 입출금 비용은 포함하지 않습니다.
원화와 달러는 합산하지 않습니다. 세금은 별도로 표시합니다.
아무 사람의 실제 거래나 API 키도 프로그램에 들어 있지 않습니다.

브라우저에서 분석: https://kim-tae-yeon.github.io/toss-fee-calculator/
소스: https://github.com/Kim-Tae-yeon/toss-fee-calculator
