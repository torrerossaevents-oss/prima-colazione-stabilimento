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
    "bridge/README.md",
    "bridge/AVVIA-PROVA.cmd", "bridge/AVVIA-SERVIZIO-SIMULAZIONE.cmd", "bridge/AVVIA-SERVIZIO-IMPIANTO.cmd",
    "bridge/STATO-PONTE.cmd", "bridge/BACKUP-ARCHIVIO.cmd", "bridge/RIPRISTINA-ARCHIVIO.cmd",
    "bridge/LEGGI-LOGO.cmd", "bridge/PROVA-INGRESSI.cmd", "bridge/_verifica-node.cmd",
    "bridge/INSTALLA-AVVIO-AUTOMATICO.cmd", "bridge/RIMUOVI-AVVIO-AUTOMATICO.cmd", "bridge/avvio-automatico.ps1",
    "bridge/logo.config.example.json", "bridge/ponte.config.example.json", "bridge/token.example.json",
    "bridge/logo.config.24ce.json", "bridge/ponte.config.24ce.json",
    "bridge/simulate.mjs", "bridge/service.mjs", "bridge/status.mjs", "bridge/backup.mjs", "bridge/read-logo.mjs", "bridge/prova-ingressi.mjs",
    "bridge/core/config.mjs", "bridge/core/counter.mjs", "bridge/core/ledger.mjs", "bridge/core/lock.mjs", "bridge/core/log.mjs",
    "bridge/core/modbus.mjs", "bridge/core/modbus-sim-server.mjs", "bridge/core/plc.mjs", "bridge/core/sensors.mjs",
    "bridge/core/service.mjs", "bridge/core/sim-gestionale.mjs", "bridge/core/sim-harness.mjs", "bridge/core/sim-plc.mjs",
    "bridge/core/store.mjs", "bridge/core/transmitter.mjs",
    "bridge/tests/backup.test.mjs", "bridge/tests/counter.test.mjs", "bridge/tests/ledger.test.mjs",
    "bridge/tests/modbus-client.test.mjs", "bridge/tests/modbus.test.mjs", "bridge/tests/sensors.test.mjs",
    "bridge/tests/service.test.mjs",
    "bridge/tests/simulation-folder.test.mjs",
    "bridge/tests/access-headers.test.mjs", "bridge/tests/lock.test.mjs", "bridge/tests/store.test.mjs", "bridge/tests/transmitter.test.mjs",
    "docs/COLLEGAMENTO-LOGO.md",
    "docs/PROGRAMMA-LOGO-24CE.md",
    "docs/FOGLIO-COLLAUDO-LINEA.md",
    "docs/CONTRATTO-PONTE.md",
]
# Mai nel pacchetto: configurazioni locali, token, archivi, log, backup.
FORBIDDEN = (".local.json", ".sqlite", ".db", ".log", "/data/", "/output/")


def main():
    payloads = {}
    for name in FILES:
        path = ROOT / name
        if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(ROOT):
            raise ValueError(f"File di pacchetto mancante o non valido: {name}")
        if any(part in name for part in FORBIDDEN):
            raise ValueError(f"File escluso dal pacchetto: {name}")
        payloads[name] = path.read_bytes()
    payloads["MANIFEST.json"] = (json.dumps({
        "package": "Prima Colazione - preparazione LOGO!",
        "purpose": "Ponte LOGO!-gestionale per il LOGO! 24CE 8.4 del progetto PC-CC01: provato in simulazione, collegato all'impianto il 20/11/2026 con una prima chiusura corretta. Collaudo in corso.",
        "version": "1.3.0",
        "sha256": {name: sha256(data).hexdigest() for name, data in payloads.items()},
    }, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    output = ROOT / "public/downloads"
    output.mkdir(parents=True, exist_ok=True)
    target = output / "ponte-logo-preparazione.zip"
    with ZipFile(target, "w", compression=ZIP_DEFLATED) as archive:
        for name, data in sorted(payloads.items()):
            info = ZipInfo("prima-colazione-logo/" + name, date_time=(2026, 11, 21, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data)
    (output / "guida-collegamento-logo.md").write_bytes(payloads["docs/COLLEGAMENTO-LOGO.md"])
    (output / "programma-logo-24ce.md").write_bytes(payloads["docs/PROGRAMMA-LOGO-24CE.md"])
    (output / "foglio-collaudo-linea.md").write_bytes(payloads["docs/FOGLIO-COLLAUDO-LINEA.md"])
    print(f"Pacchetto creato: {target.name}; {len(payloads)} file; {target.stat().st_size} byte.")


if __name__ == "__main__":
    main()
