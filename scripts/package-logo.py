"""Build the reproducible public preparation download from an explicit allowlist.

Never include local configuration, ledgers, logs, exports or credentials.
Run from any directory: python scripts/package-logo.py
"""
from hashlib import sha256
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import json

ROOT = Path(__file__).resolve().parent.parent
FILES = [
    "bridge/README.md", "bridge/AVVIA-PROVA.cmd", "bridge/LEGGI-LOGO.cmd",
    "bridge/logo.config.example.json", "bridge/simulate.mjs", "bridge/read-logo.mjs",
    "bridge/core/ledger.mjs", "bridge/core/modbus.mjs",
    "bridge/tests/ledger.test.mjs", "bridge/tests/modbus.test.mjs",
    "docs/COLLEGAMENTO-LOGO.md",
]


def main():
    payloads = {}
    for name in FILES:
        path = ROOT / name
        if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(ROOT):
            raise ValueError(f"File di pacchetto mancante o non valido: {name}")
        payloads[name] = path.read_bytes()
    payloads["MANIFEST.json"] = (json.dumps({
        "package": "Prima Colazione - preparazione LOGO!",
        "purpose": "Simulazione locale e lettura diagnostica. Nessun collegamento operativo al CRM.",
        "sha256": {name: sha256(data).hexdigest() for name, data in payloads.items()},
    }, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    output = ROOT / "public/downloads"
    output.mkdir(parents=True, exist_ok=True)
    target = output / "ponte-logo-preparazione.zip"
    with ZipFile(target, "w", compression=ZIP_DEFLATED) as archive:
        for name, data in sorted(payloads.items()):
            info = ZipInfo("prima-colazione-logo/" + name, date_time=(2026, 11, 9, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data)
    (output / "guida-collegamento-logo.md").write_bytes(payloads["docs/COLLEGAMENTO-LOGO.md"])
    print(f"Pacchetto creato: {target.name}; {len(payloads)} file; {target.stat().st_size} byte.")


if __name__ == "__main__":
    main()
