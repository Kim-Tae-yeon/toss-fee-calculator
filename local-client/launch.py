"""Portable API-only launcher. No saved user data is bundled or auto-loaded."""
import sys
import threading
import webbrowser
import json
from urllib.request import urlopen
from fee_tool import FeeServer


if __name__ == '__main__':
    server = FeeServer(('127.0.0.1', 0), load_saved=False)
    address = f'http://127.0.0.1:{server.server_port}'
    if '--smoke-test' in sys.argv:
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        with urlopen(address+'/api/state') as response:
            assert json.load(response)['status'] == 'idle'
        with urlopen(address) as response:
            assert response.status == 200
        for path in ['/audit/','/audit/app.js','/audit/engine.js','/audit/audit.js','/audit/audit-ui.js','/audit/bridge.js']:
            with urlopen(address+path) as response:
                assert response.status == 200
        server.shutdown()
        server.server_close()
        print('Portable client smoke test passed')
    else:
        print('Toss Fee Analyzer - local, read-only API client')
        print(address)
        print('Close this window or press Ctrl+C to stop.')
        threading.Timer(0.5, lambda: webbrowser.open(address)).start()
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()
