"""Copy public calculator code into the portable offline/local client. No user data."""
from pathlib import Path

root=Path(__file__).resolve().parent
dest=root/'local-client'/'audit'
dest.mkdir(exist_ok=True)
for name in ['index.html','app.js','engine.js','audit.js','audit-ui.js','style.css']:
    content=(root/name).read_text(encoding='utf8')
    if name=='index.html':
        content=content.replace('</head>','<script type="module" src="bridge.js"></script></head>')
        content=content.replace("connect-src 'none'", "connect-src 'self'")
    (dest/name).write_text(content,encoding='utf8')
(dest/'bridge.js').write_text('''import {loadReport} from "./app.js?v=1.2.0";
try{const r=await fetch("/api/report");if(r.ok){loadReport(await r.json());const section=document.getElementById("audit-section");section.tabIndex=-1;section.focus();}}
catch{document.getElementById("status").textContent="로컬 보고서를 불러오지 못했습니다. 파일을 직접 선택하세요.";}
''',encoding='utf8')
