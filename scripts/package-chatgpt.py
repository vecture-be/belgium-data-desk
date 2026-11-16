#!/usr/bin/env python3
"""Validate and reproducibly package the hosted ChatGPT plugin; no network or dependencies."""
import hashlib
import json
import re
import sys
import zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parents[1]
source = root / 'plugins/belgium-data-desk'
manifest = json.loads((source / 'plugin.json').read_text())
mcp = json.loads((source / 'mcp.json').read_text())
ext = manifest['extensions']['com.openai']
ui = ext['interface']
assert manifest['name'] == 'belgium-data-desk'
assert re.fullmatch(r'\d+\.\d+\.\d+', manifest['version'])
for field, maximum in [('displayName',30),('shortDescription',30),('longDescription',4000),('developerName',80)]:
    assert 0 < len(ui[field]) <= maximum, field
for field in ['websiteURL','supportURL','privacyPolicyURL','termsOfServiceURL']:
    assert ui[field].startswith('https://') and len(ui[field]) <= 1024, field
assert len(ui['defaultPrompt']) <= 3 and all(len(x) <= 128 for x in ui['defaultPrompt'])
assert list(mcp['mcpServers']) == ['belgium-data-desk']
server = mcp['mcpServers']['belgium-data-desk']
assert server['url'] == 'https://data.vecture.be/mcp'
assert server['type'] == 'streamable-http' and not server.get('headers')
assert set(server) == {'type', 'url'}  # public no-auth endpoint; portable schema 1.0.0
cases = ext['review']['test_cases']
assert len(cases['positive']) == 5 and len(cases['negative']) == 3
for kind, rows in cases.items():
    for case in rows:
        assert case['description'] and case['prompt'] and case['expected_behavior']
        if kind == 'positive':
            assert case['tools_triggered']
skill = source / 'skills/belgian-open-data/SKILL.md'
assert skill.read_text().startswith('---\nname: belgian-open-data\ndescription: ')
files = ['LICENSE','README.md','plugin.json','mcp.json','assets/icon.svg','skills/belgian-open-data/SKILL.md']
for field in ['logo','composerIcon']:
    assert ui[field].startswith('./') and ui[field][2:] in files
icon = ET.parse(source / ui['logo']).getroot()
assert float(icon.attrib['width']) == float(icon.attrib['height']) >= 48
assert not ext.get('hooks')
out = Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'public/downloads/belgium-data-desk-chatgpt.zip'
out.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_DEFLATED) as z:
    for name in sorted(files):
        path = source / name
        assert path.is_file() and not path.is_symlink()
        info = zipfile.ZipInfo(name, date_time=(2026,1,1,0,0,0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        z.writestr(info, path.read_bytes())
with zipfile.ZipFile(out) as z:
    assert z.testzip() is None and set(z.namelist()) == set(files)
print(json.dumps({'file':str(out),'version':manifest['version'],'sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'bytes':out.stat().st_size}))
