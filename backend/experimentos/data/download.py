"""Download the raw Criteo uplift file, pinned to a repository revision, and verify it."""
from __future__ import annotations

import hashlib
import urllib.request
from pathlib import Path

from .. import config


def sha256_of(path: Path, chunk: int = 1 << 22) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(chunk), b""):
            h.update(block)
    return h.hexdigest()


def raw_path() -> Path:
    return config.RAW_DIR / config.RAW_FILENAME


def verify_raw(path: Path | None = None) -> dict:
    """Return checksum facts for the raw file. Raises if it does not match the pinned hash."""
    path = path or raw_path()
    if not path.exists():
        raise FileNotFoundError(
            f"{path} not found. Run `python -m experimentos.pipeline download` first."
        )
    digest = sha256_of(path)
    size = path.stat().st_size
    ok = digest == config.DATASET["raw_sha256"]
    if not ok:
        raise ValueError(
            f"Checksum mismatch for {path.name}: got {digest}, "
            f"expected {config.DATASET['raw_sha256']}. Refusing to analyse an unverified file."
        )
    # Record a project-relative path: manifests are published, absolute paths would leak local details.
    try:
        shown = str(path.resolve().relative_to(config.ROOT.resolve()))
    except ValueError:
        shown = path.name
    return {"path": shown, "sha256": digest, "bytes": size, "sha256_matches_pinned": ok}


def download(force: bool = False) -> dict:
    path = raw_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and not force:
        try:
            return verify_raw(path)
        except ValueError:
            path.unlink()  # corrupt / partial download: fetch again
    tmp = path.with_suffix(".part")
    print(f"Downloading {config.DATASET['source_url']}")
    with urllib.request.urlopen(config.DATASET["source_url"]) as resp, open(tmp, "wb") as out:
        while True:
            block = resp.read(1 << 22)
            if not block:
                break
            out.write(block)
    tmp.rename(path)
    return verify_raw(path)
