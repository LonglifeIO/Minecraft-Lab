#!/usr/bin/env python3
"""Build a custom Bedrock add-on from a source directory and place it in
the MinecraftLab library as type=custom.

Source layout expected:
    mods/<slug>/
        manifest.json
        scripts/...
        (and/or any other pack contents)

Usage:
    ./build.py "Family Compass"
    ./build.py "My Mod" --source ./my-mod --description "..." --author "Me"
"""

import os
import sys
import json
import re
import base64
import hashlib
import zipfile
import argparse
from datetime import datetime

LIBRARY_DIR = "/var/lib/minecraftlab/library"

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def slug_id(name):
    base = _SLUG_RE.sub("-", (name or "").lower()).strip("-") or "addon"
    h = hashlib.sha1((name or "").encode("utf-8")).hexdigest()[:8]
    return f"{base[:48]}-{h}"


def build_mcaddon(source_dir, output_path):
    """Zip the source dir contents (manifest.json at root) into a .mcaddon."""
    with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, _, files in os.walk(source_dir):
            for fname in files:
                full = os.path.join(root, fname)
                rel = os.path.relpath(full, source_dir)
                zf.write(full, rel)


def parse_archive_packs(archive_path):
    """Find every manifest.json in the archive and return pack info."""
    with zipfile.ZipFile(archive_path, "r") as zf:
        manifests = [
            n for n in zf.namelist()
            if os.path.basename(n.rstrip("/")) == "manifest.json" and not n.endswith("/")
        ]
        results = []
        for mp in manifests:
            with zf.open(mp) as f:
                manifest = json.load(f)
            header = manifest.get("header", {})
            modules = manifest.get("modules") or []
            module_type = ""
            for m in modules:
                if m.get("type") in ("data", "resources", "script"):
                    module_type = m.get("type")
                    break
            if not module_type and modules:
                module_type = modules[0].get("type", "")
            results.append({
                "uuid": header.get("uuid"),
                "name": header.get("name", ""),
                "version": header.get("version", []),
                "type": module_type,
            })
        return [p for p in results if p.get("uuid")]


def main():
    parser = argparse.ArgumentParser(description="Build a custom Bedrock add-on into the MinecraftLab library.")
    parser.add_argument("name", help="Library entry name (e.g. 'Family Compass')")
    parser.add_argument("--source", default=None, help="Source dir (defaults to <slug>/ next to this script)")
    parser.add_argument("--description", default="", help="Description text")
    parser.add_argument("--author", default="MinecraftLab", help="Author name")
    args = parser.parse_args()

    here = os.path.dirname(os.path.abspath(__file__))
    default_slug = re.sub(r"[^a-z0-9]+", "-", args.name.lower()).strip("-")
    source = args.source or os.path.join(here, default_slug)
    if not os.path.isdir(source):
        sys.exit(f"source dir not found: {source}")
    if not os.path.isfile(os.path.join(source, "manifest.json")):
        sys.exit(f"no manifest.json at {source}")

    library_id = slug_id(args.name)
    target_dir = os.path.join(LIBRARY_DIR, library_id)
    os.makedirs(target_dir, exist_ok=True)
    archive_path = os.path.join(target_dir, "archive.mcaddon")

    build_mcaddon(source, archive_path)
    packs = parse_archive_packs(archive_path)
    if not packs:
        sys.exit("no packs found in built archive — check manifest.json")

    version = ".".join(str(v) for v in (packs[0].get("version") or []))

    # If the pack ships a pack_icon.png at its root, embed it as a data URL so
    # the library card has a thumbnail without us having to host an icon route.
    icon_path = os.path.join(source, "pack_icon.png")
    thumb_url = ""
    if os.path.isfile(icon_path):
        with open(icon_path, "rb") as f:
            thumb_url = "data:image/png;base64," + base64.b64encode(f.read()).decode("ascii")

    meta = {
        "id": library_id,
        "name": args.name,
        "description": args.description,
        "version": version,
        "type": "custom",
        "author": args.author,
        "thumbUrl": thumb_url,
        "source": {"kind": "custom", "builder": "claude"},
        "packs": [{"uuid": p["uuid"], "name": p.get("name", ""), "type": p.get("type", "")} for p in packs],
        "packUuids": [p["uuid"] for p in packs],
        "sizeBytes": os.path.getsize(archive_path),
        "addedAt": datetime.now().isoformat(),
    }
    meta_path = os.path.join(target_dir, "meta.json")
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)

    print(f"built {library_id}")
    print(f"  packs:   {len(packs)} ({', '.join(p['type'] for p in packs)})")
    print(f"  size:    {meta['sizeBytes']} bytes")
    print(f"  archive: {archive_path}")
    print(f"  meta:    {meta_path}")


if __name__ == "__main__":
    main()
