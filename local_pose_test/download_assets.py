"""Fetch only the agreed Lite model and fixed browser runtime; no package install."""

from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import tarfile
import tempfile
from urllib.request import Request, urlopen
import zipfile


ROOT = Path(__file__).resolve().parent / "assets"
MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_lite/float16/1/pose_landmarker_lite.task"
)
MODEL_SIZE = 5_777_746
PACKAGE_VERSION = "1.0.1"
METADATA_URL = f"https://registry.npmjs.org/@mediapipe/tasks-vision/{PACKAGE_VERSION}"
PACKAGE_URL = (
    "https://registry.npmjs.org/@mediapipe/tasks-vision/-/"
    f"tasks-vision-{PACKAGE_VERSION}.tgz"
)
MAX_DOWNLOAD = 100_000_000


def fetch(url: str, destination: Path) -> dict:
    """Stream into a temporary file and validate response size before publishing."""
    digest = hashlib.sha256()
    md5 = hashlib.md5()
    sha512 = hashlib.sha512()
    total = 0
    request = Request(url, headers={"User-Agent": "Motion-Analysis-Asset-Download/1.0"})
    with urlopen(request, timeout=45) as response, destination.open("wb") as output:
        expected = int(response.headers.get("Content-Length", "0"))
        if expected > MAX_DOWNLOAD:
            raise ValueError("Resource is larger than the agreed small download limit.")
        cloud_hashes = response.headers.get("x-goog-hash", "")
        while chunk := response.read(1024 * 1024):
            total += len(chunk)
            if total > MAX_DOWNLOAD:
                raise ValueError("Download exceeded the small resource limit.")
            output.write(chunk)
            digest.update(chunk)
            md5.update(chunk)
            sha512.update(chunk)
        if expected and total != expected:
            raise ValueError("Incomplete download: size does not match server headers.")
        for item in cloud_hashes.split(","):
            item = item.strip()
            if item.startswith("md5="):
                if base64.b64encode(md5.digest()).decode() != item[4:]:
                    raise ValueError("Model integrity check failed (Google MD5).")
    return {
        "bytes": total,
        "sha256": digest.hexdigest(),
        "sha512_base64": base64.b64encode(sha512.digest()).decode(),
    }


def main() -> None:
    model_path = ROOT / "models" / "pose_landmarker_lite.task"
    runtime_path = ROOT / "vendor" / "tasks-vision"
    if model_path.exists() or runtime_path.exists():
        raise FileExistsError("Asset targets already exist; refusing to overwrite them.")
    ROOT.mkdir(parents=True, exist_ok=True)
    with urlopen(METADATA_URL, timeout=45) as response:
        metadata = json.loads(response.read(2_000_000))
    if metadata.get("name") != "@mediapipe/tasks-vision" or metadata.get("version") != PACKAGE_VERSION:
        raise ValueError("Unexpected package metadata.")
    distribution = metadata["dist"]
    if distribution["tarball"] != PACKAGE_URL:
        raise ValueError("Unexpected package download host or filename.")
    algorithm, expected_integrity = distribution["integrity"].split("-", 1)
    if algorithm != "sha512":
        raise ValueError("Expected registry SHA-512 integrity metadata.")

    # Only these newly created temporary resources are removed by this context.
    with tempfile.TemporaryDirectory(prefix="download-", dir=ROOT) as temporary:
        work = Path(temporary)
        if not work.resolve().is_relative_to(ROOT.resolve()):
            raise ValueError("Temporary directory escaped the selected asset directory.")
        print("Downloading Lite model...", flush=True)
        model_temp = work / "pose_landmarker_lite.task"
        model_info = fetch(MODEL_URL, model_temp)
        if model_info["bytes"] != MODEL_SIZE:
            raise ValueError("Unexpected Lite model size.")
        with zipfile.ZipFile(model_temp) as bundle:
            if bundle.testzip() is not None:
                raise ValueError("Model bundle CRC integrity check failed.")
            model_info["bundle_files"] = bundle.namelist()

        print(f"Downloading browser runtime {PACKAGE_VERSION}...", flush=True)
        archive_path = work / "runtime.tgz"
        archive_info = fetch(PACKAGE_URL, archive_path)
        if archive_info["sha512_base64"] != expected_integrity:
            raise ValueError("Runtime integrity check failed (registry SHA-512).")
        unpacked = work / "unpacked"
        unpacked.mkdir()
        with tarfile.open(archive_path, "r:gz") as archive:
            members = archive.getmembers()
            total_size = 0
            for member in members:
                path = PurePosixPath(member.name)
                if path.is_absolute() or ".." in path.parts or not path.parts or path.parts[0] != "package":
                    raise ValueError("Unsafe package archive path.")
                if not member.isdir() and not member.isfile():
                    raise ValueError("Package links and special files are not accepted.")
                if member.size < 0:
                    raise ValueError("Invalid archived file size.")
                total_size += member.size
                if total_size > MAX_DOWNLOAD:
                    raise ValueError("Runtime unpacked size exceeds the resource limit.")
            if total_size != distribution["unpackedSize"]:
                raise ValueError("Runtime size does not match registry metadata.")
            archive.extractall(unpacked, members=members, filter="data")
        package = unpacked / "package"
        if not (package / "vision_bundle.mjs").is_file():
            raise ValueError("Runtime JavaScript entry is missing.")
        if not list((package / "wasm").glob("*.wasm")):
            raise ValueError("Runtime WebAssembly files are missing.")
        package_info = json.loads((package / "package.json").read_text(encoding="utf-8"))
        if package_info["version"] != PACKAGE_VERSION:
            raise ValueError("Extracted package has an unexpected version.")
        files = []
        for path in sorted(package.rglob("*")):
            if path.is_file():
                with path.open("rb") as source:
                    file_hash = hashlib.file_digest(source, "sha256").hexdigest()
                files.append({
                    "path": path.relative_to(package).as_posix(),
                    "bytes": path.stat().st_size,
                    "sha256": file_hash,
                })
        model_path.parent.mkdir(parents=True, exist_ok=True)
        runtime_path.parent.mkdir(parents=True, exist_ok=True)
        for destination in (model_path, runtime_path):
            if not destination.resolve().is_relative_to(ROOT.resolve()):
                raise ValueError("Asset destination escaped the selected directory.")
        if not package.resolve().is_relative_to(ROOT.resolve()):
            raise ValueError("Unpacked runtime escaped the selected asset directory.")
        # Create final files under their normal project parents. Moving files out
        # of a private Windows temporary directory would preserve its restrictive ACL.
        with model_temp.open("rb") as source, model_path.open("xb") as target:
            shutil.copyfileobj(source, target, 1024 * 1024)
        shutil.copytree(package, runtime_path, copy_function=shutil.copyfile)
        manifest = {
            "model": {"path": "models/pose_landmarker_lite.task", "url": MODEL_URL, **model_info},
            "runtime": {
                "path": "vendor/tasks-vision", "version": PACKAGE_VERSION,
                "url": PACKAGE_URL, "license": metadata.get("license"),
                "registry_integrity": distribution["integrity"],
                "archive_bytes": archive_info["bytes"],
                "archive_sha256": archive_info["sha256"],
                "unpacked_bytes": total_size, "files": files,
            },
            "integrity_verified": True,
            "inference_tested": False,
            "asset_bytes": model_info["bytes"] + total_size,
        }
        (ROOT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({
            "model": str(model_path), "runtime": str(runtime_path),
            "resource_bytes": manifest["asset_bytes"], "files": len(files),
            "checksums_verified": True, "inference_tested": False,
        }, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
