#!/usr/bin/env python3
"""Notify a vibed-infra VPS to pull a GHCR image.

Prefers GitHub Actions OIDC (no shared secret). Falls back to compiled
config token / VIBED_WEBHOOK_SECRET for local curl.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

# Keep in sync with lib/webhook.py
HOOK_PATH = "/_vibed/hooks/ghcr"
TOKEN_VERSION = "vibed-webhook|v1|"


def _derive_token(name: str, public_ip: str, host: str) -> str:
    import hashlib

    raw = f"{TOKEN_VERSION}{name}|{public_ip}|{host}"
    return hashlib.sha256(raw.encode()).hexdigest()[:32]


def _strip(s: str) -> str:
    s = s.strip()
    if (s.startswith('"') and s.endswith('"')) or (s.startswith("'") and s.endswith("'")):
        return s[1:-1]
    return s


def _load_webhook(path: Path) -> dict[str, str]:
    text = path.read_text(encoding="utf-8")
    url = fallback = token = name = public_ip = host = ""
    in_webhook = False
    in_sites = False
    for raw in text.splitlines():
        line = raw.rstrip()
        stripped = line.lstrip()
        if stripped.startswith("webhook:"):
            in_webhook = True
            in_sites = False
            continue
        if in_webhook:
            if stripped and not line.startswith(" ") and not line.startswith("\t"):
                in_webhook = False
            elif stripped.startswith("url:"):
                url = _strip(stripped.split(":", 1)[1])
            elif stripped.startswith("fallbackUrl:"):
                fallback = _strip(stripped.split(":", 1)[1])
            elif stripped.startswith("token:"):
                token = _strip(stripped.split(":", 1)[1])
        if stripped.startswith("name:") and not name:
            name = _strip(stripped.split(":", 1)[1])
        if stripped.startswith("publicIp:"):
            public_ip = _strip(stripped.split(":", 1)[1])
        if stripped.startswith("sites:"):
            in_sites = True
            continue
        if in_sites and stripped.startswith("- host:"):
            host = _strip(stripped.split(":", 1)[1])
            in_sites = False
        elif in_sites and stripped.startswith("host:"):
            host = _strip(stripped.split(":", 1)[1])
            in_sites = False
    if not token and name and (public_ip or host):
        token = _derive_token(name, public_ip, host)
    if not url and host:
        url = f"https://{host}{HOOK_PATH}"
    if not fallback and public_ip:
        fallback = f"http://{public_ip}{HOOK_PATH}"
    if not url:
        url = fallback
    return {"url": url, "fallbackUrl": fallback, "token": token}


def _package_from_image(image: str) -> str:
    img = image.split("@", 1)[0]
    if "/" in img:
        return img.rsplit("/", 1)[-1].split(":")[0]
    return img.split(":")[0]


def fetch_oidc_token(audience: str) -> str:
    url = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_URL") or ""
    tok = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_TOKEN") or ""
    if not url or not tok:
        return ""
    sep = "&" if "?" in url else "?"
    req = urllib.request.Request(
        f"{url}{sep}audience={urllib.parse.quote(audience, safe='')}",
        headers={"Authorization": f"Bearer {tok}", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode())
        return str(data.get("value") or "")
    except Exception as e:
        print(f"notify-vps: OIDC mint failed: {e}", file=sys.stderr)
        return ""


def _post(url: str, body: dict, *, bearer: str = "", secret: str = "") -> tuple[int, str]:
    headers = {"Content-Type": "application/json"}
    if bearer:
        headers["Authorization"] = f"Bearer {bearer}"
    if secret:
        headers["X-Vibed-Secret"] = secret
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        method="POST",
        headers=headers,
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status, resp.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")
    except Exception as e:
        return 0, str(e)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", required=True)
    ap.add_argument("--tag", default="main")
    ap.add_argument("--config", default="")
    ap.add_argument("--url", action="append", default=[], help="Override webhook URL (repeatable)")
    ap.add_argument("--strict", action="store_true", help="Exit 1 if notify fails")
    args = ap.parse_args()

    spec = {"url": "", "fallbackUrl": "", "token": ""}
    if not args.url:
        roots = []
        if args.config:
            roots.append(Path(args.config))
        cwd = Path.cwd()
        roots.extend(
            [
                cwd / "dist" / "packageconfig.yaml",
                cwd / "packageconfig.yaml",
                cwd / "templates" / "vibed-infra-config.yml",
            ]
        )
        conf_path = next((p for p in roots if p.is_file()), None)
        if conf_path:
            spec = _load_webhook(conf_path)
        elif not args.url:
            print("notify-vps: no packageconfig (set gateway.publicIp + sites[].host)", file=sys.stderr)
            return 1 if args.strict else 0

    token = os.environ.get("VIBED_WEBHOOK_SECRET") or spec.get("token") or ""
    urls = list(args.url) if args.url else [u for u in (spec.get("url"), spec.get("fallbackUrl")) if u]
    seen: set[str] = set()
    urls = [u for u in urls if not (u in seen or seen.add(u))]
    has_oidc = bool(os.environ.get("ACTIONS_ID_TOKEN_REQUEST_URL"))
    if not urls:
        print("notify-vps: skipped (no webhook url)", file=sys.stderr)
        return 1 if args.strict else 0
    if not has_oidc and not token:
        print("notify-vps: skipped (no OIDC env and no token)", file=sys.stderr)
        return 1 if args.strict else 0

    pkg = _package_from_image(args.image)
    payload = {"package": pkg, "tag": args.tag, "image": args.image}
    last_err = ""
    for url in urls:
        bearer = fetch_oidc_token(url) if has_oidc else ""
        secret = "" if bearer else token
        if not bearer and not secret:
            last_err = f"{url}: no OIDC token"
            print(f"notify-vps: {last_err}", file=sys.stderr)
            continue
        try:
            code, text = _post(url, payload, bearer=bearer, secret=secret)
        except Exception as e:
            code, text = 0, str(e)
        if code == 200:
            print(f"notify-vps: {url} → {text.strip()}")
            return 0
        last_err = f"{url} HTTP {code}: {text[:200]}"
        print(f"notify-vps: {last_err}", file=sys.stderr)
    print(f"notify-vps: failed ({last_err})", file=sys.stderr)
    return 1 if args.strict else 0


if __name__ == "__main__":
    raise SystemExit(main())
