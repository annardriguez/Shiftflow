"""Package the local fictional-data source, excluding runtime data and dependencies."""
from pathlib import Path
import hashlib
import json
import os
import zipfile

ROOT = Path(__file__).resolve().parents[1]
EXCLUDED = {"node_modules", ".next", ".venv", ".data", ".git", "__pycache__", ".pytest_cache", ".ruff_cache"}
manifest_path = ROOT / "artifacts/release-manifest.json"
files = []
for current, directories, names in os.walk(ROOT):
    directories[:] = [name for name in directories if name not in EXCLUDED]
    for name in names:
        item = Path(current) / name
        if item == manifest_path or item.is_symlink():
            continue
        if name.endswith((".zip", ".tsbuildinfo", ".pyc")) or name == ".DS_Store":
            continue
        if name.startswith(".env") and name != ".env.example":
            continue
        files.append(item)
files.sort()
version = json.loads((ROOT / "package.json").read_text())["version"]
milestone = version.split(".")[1]
evidence = json.loads((ROOT / f"artifacts/milestone{milestone}-verification.json").read_text())
manifest = {
    "version": version,
    "verified_root": str(ROOT),
    "fictional_data_only": True,
    "external_sync": "not_connected",
    "checks": evidence,
    "files": {str(file.relative_to(ROOT)): hashlib.sha256(file.read_bytes()).hexdigest() for file in files},
}
manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
archive = ROOT / f"artifacts/shiftflow-milestone{milestone}-source.zip"
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
    for file in [*files, manifest_path]:
        bundle.write(file, file.relative_to(ROOT))
with zipfile.ZipFile(archive) as bundle:
    assert bundle.testzip() is None
    for name, digest in manifest["files"].items():
        assert hashlib.sha256(bundle.read(name)).hexdigest() == digest
print(f"Verified {len(files) + 1} files in {archive} ({archive.stat().st_size} bytes)")
