"""
Bastion — <10ms deterministic pre-flight engine ($0 LLM cost).

Pure-Python regex + WCAG 2.1 luminance math (+ optional Pillow image sampling).
Input is the manifest DICT (from the in-memory cache), never a DB call.
Output flags are plain dicts matching the ViolationItem schema exactly.
"""
import base64
import io
import logging
import math
import re
import uuid

try:  # Pillow is only needed when an image is supplied
    from PIL import Image
except Exception:  # pragma: no cover
    Image = None

logger = logging.getLogger("bastion.deterministic")

# -----------------------------------------------------------------------------
# Constants
# -----------------------------------------------------------------------------
WCAG_AA = 4.5
WCAG_AAA = 7.0

PALETTE_TOLERANCE_UI = 12.0     # RGB distance: FG/BG treated as on-palette if this close (#FFFFFF ~ #F8FAFC)
PALETTE_TOLERANCE_IMAGE = 48.0  # looser: gradients, anti-aliasing, compression noise
IMAGE_MIN_SHARE = 0.10          # ignore colors covering <10% of the image
IMAGE_MAX_OFFBRAND_FLAGS = 3
MAX_IMAGE_B64_CHARS = 20_000_000

CIT_CONTRAST = "Section 6.1 — Accessibility Standard (WCAG 2.1 SC 1.4.3)"
CIT_ALT_TEXT = "Section 6.2 — Accessibility Standard (WCAG 2.1 SC 1.1.1)"
CIT_PALETTE = "Section 1.3 — Approved Color Palette (Brand Guidelines v2.4)"
CIT_IMAGE = "Section 6.4 — Image Submission Requirements"

_GENERIC_ALT = {
    "image", "images", "photo", "picture", "pic", "graphic", "banner", "img",
    "logo", "icon", "screenshot", "untitled", "alt", "alt text", "image of", "photo of",
}
_FILENAME_RX = re.compile(r"\.(?:png|jpe?g|gif|webp|svg|bmp|tiff?)$", re.IGNORECASE)
_HEX_RX = re.compile(r"^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")


# -----------------------------------------------------------------------------
# Shared helpers
# -----------------------------------------------------------------------------
def _new_flag_id() -> str:
    return f"flag_{uuid.uuid4().hex[:12]}"


def _flag(category, rule_id, citation, quote, explanation, fix, severity) -> dict:
    return {
        "flag_id": _new_flag_id(),
        "category": category,
        "rule_id": rule_id,
        "rule_citation": citation,
        "exact_quote": quote,
        "explanation": explanation,
        "surgical_fix": fix,
        "severity": severity,
        "status": "OPEN",
    }


def _overlaps(spans: list[tuple[int, int]], start: int, end: int) -> bool:
    return any(start < e and end > s for s, e in spans)


def _match_case(original: str, replacement: str) -> str:
    """Carry the original's capitalization onto the replacement."""
    if not replacement:
        return replacement
    letters = [c for c in original if c.isalpha()]
    if len(letters) >= 4 and original.isupper():
        return replacement.upper()
    if original[:1].isupper() and replacement[:1].islower():
        return replacement[0].upper() + replacement[1:]
    return replacement


def _flexible_literal(term: str) -> str:
    """Case/whitespace-flexible regex source for a plain-text term."""
    return r"\s+".join(re.escape(tok) for tok in term.split())


# -----------------------------------------------------------------------------
# Compiled-rule cache (regex compiled once per manifest version, not per request)
# -----------------------------------------------------------------------------
_COMPILED_CACHE: dict[tuple, tuple[list, list]] = {}


def _compile_rules(manifest: dict) -> tuple[list, list]:
    key = (manifest.get("brand_id", ""), manifest.get("version", ""), manifest.get("updated_at", ""))
    cached = _COMPILED_CACHE.get(key)
    if cached is not None:
        return cached

    banned: list[tuple[dict, re.Pattern]] = []
    for term in manifest.get("banned_terms", []):
        source = term.get("pattern") or (_flexible_literal(term["term"]) if term.get("term") else None)
        if not source:
            continue
        try:
            banned.append((term, re.compile(source, re.IGNORECASE)))
        except re.error as exc:
            logger.warning("Skipping invalid banned-term regex for %s: %s", term.get("rule_id"), exc)

    disclaimers: list[tuple[dict, re.Pattern, re.Pattern | None]] = []
    for rule in manifest.get("voice_rules", []):
        if rule.get("type") != "required_disclaimer":
            continue
        triggers = rule.get("trigger_patterns") or []
        if not triggers:
            continue
        try:
            trigger_rx = re.compile("|".join(f"(?:{p})" for p in triggers), re.IGNORECASE)
            phrases = rule.get("required_phrases") or []
            present_rx = (
                re.compile("|".join(f"(?:{_flexible_literal(p)})" for p in phrases), re.IGNORECASE)
                if phrases else None
            )
        except re.error as exc:
            logger.warning("Skipping invalid disclaimer regex for %s: %s", rule.get("rule_id"), exc)
            continue
        disclaimers.append((rule, trigger_rx, present_rx))

    # Keep the cache bounded if manifests are re-versioned frequently.
    if len(_COMPILED_CACHE) > 64:
        _COMPILED_CACHE.clear()
    _COMPILED_CACHE[key] = (banned, disclaimers)
    return banned, disclaimers


# -----------------------------------------------------------------------------
# 1) Deterministic TEXT checks
# -----------------------------------------------------------------------------
def run_deterministic_text_checks(text: str, manifest: dict) -> list[dict]:
    """
    Scan for banned terms and missing required disclaimers.
    Every `exact_quote` is text[match.start():match.end()] — a true substring of `text`.
    Returns ViolationItem-shaped dicts ordered by position in the draft.
    """
    if not text:
        return []

    banned, disclaimers = _compile_rules(manifest)
    positioned: list[tuple[int, dict]] = []
    spans: list[tuple[int, int]] = []

    # --- Banned terms ---------------------------------------------------------
    for term, rx in banned:
        for m in rx.finditer(text):
            start, end = m.start(), m.end()
            if start == end or _overlaps(spans, start, end):
                continue
            spans.append((start, end))
            quote = text[start:end]
            rule_id = term.get("rule_id", "TERM-00")
            replacement = _match_case(quote, term.get("replacement", ""))
            positioned.append((start, _flag(
                category=term.get("category", "TERMINOLOGY"),
                rule_id=rule_id,
                citation=term.get("citation", "Brand Guidelines — Banned Terminology"),
                quote=quote,
                explanation=term.get("explanation") or f"'{quote}' is prohibited terminology ({rule_id}).",
                fix=replacement,
                severity=term.get("severity", "MEDIUM"),
            )))

    # --- Missing required disclaimers ----------------------------------------
    for rule, trigger_rx, present_rx in disclaimers:
        if present_rx is not None and present_rx.search(text):
            continue  # disclaimer already present anywhere in the draft
        for m in trigger_rx.finditer(text):
            start, end = m.start(), m.end()
            if start == end or _overlaps(spans, start, end):
                continue
            quote = text[start:end]
            required = rule.get("required_text", "")
            positioned.append((start, _flag(
                category=rule.get("category", "TERMINOLOGY"),
                rule_id=rule.get("rule_id", "DISC-00"),
                citation=rule.get("citation", "Brand Guidelines — Required Disclaimers"),
                quote=quote,
                explanation=(rule.get("explanation") or "Required disclaimer missing.")
                            + f" Missing: \"{required}\".",
                fix=f"{quote} ({required})" if required else quote,
                severity=rule.get("severity", "CRITICAL_LEGAL"),
            )))
            break  # one flag per disclaimer rule

    positioned.sort(key=lambda pair: pair[0])
    return [f for _, f in positioned]


# -----------------------------------------------------------------------------
# 2) Deterministic WCAG / visual checks
# -----------------------------------------------------------------------------
def hex_to_rgb(value: str) -> tuple[int, int, int] | None:
    """Parse #RGB / #RRGGBB (with or without '#'). Returns None if invalid."""
    if not isinstance(value, str):
        return None
    m = _HEX_RX.match(value.strip())
    if not m:
        return None
    digits = m.group(1)
    if len(digits) == 3:
        digits = "".join(ch * 2 for ch in digits)
    return int(digits[0:2], 16), int(digits[2:4], 16), int(digits[4:6], 16)


def rgb_to_hex(rgb: tuple[int, int, int]) -> str:
    return "#{:02X}{:02X}{:02X}".format(*rgb)


def _linearize(channel: int) -> float:
    c = channel / 255.0
    return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4


def relative_luminance(rgb: tuple[int, int, int]) -> float:
    """WCAG 2.1 relative luminance."""
    r, g, b = (_linearize(ch) for ch in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast_ratio(fg: tuple[int, int, int], bg: tuple[int, int, int]) -> float:
    """WCAG 2.1 contrast ratio (1.0 - 21.0). Pure math — no third-party dependency."""
    l1, l2 = relative_luminance(fg), relative_luminance(bg)
    lighter, darker = (l1, l2) if l1 >= l2 else (l2, l1)
    return (lighter + 0.05) / (darker + 0.05)


def _nearest_palette(rgb, palette):
    best_hex, best_dist = None, float("inf")
    for hx, prgb in palette:
        d = math.dist(rgb, prgb)
        if d < best_dist:
            best_hex, best_dist = hx, d
    return best_hex, best_dist


def _suggest_foreground(fg_rgb, bg_rgb, palette, min_ratio) -> str:
    """Approved-palette foreground nearest the original that meets the ratio; else black/white."""
    needed = max(min_ratio, WCAG_AA)
    passing = [(hx, prgb) for hx, prgb in palette if contrast_ratio(prgb, bg_rgb) >= needed]
    if passing:
        return min(passing, key=lambda item: math.dist(item[1], fg_rgb))[0]
    white, black = (255, 255, 255), (0, 0, 0)
    return "#FFFFFF" if contrast_ratio(white, bg_rgb) >= contrast_ratio(black, bg_rgb) else "#000000"


def _extract_dominant_colors(image_b64: str, k: int = 5) -> list[dict]:
    """Return [{'hex': '#RRGGBB', 'share': 0..1}, ...] sorted by share desc."""
    if Image is None:
        raise RuntimeError("Pillow is not installed")
    if len(image_b64) > MAX_IMAGE_B64_CHARS:
        raise ValueError("image payload too large")
    payload = image_b64.split(",", 1)[1] if image_b64.startswith("data:") else image_b64
    raw = base64.b64decode(payload)

    with Image.open(io.BytesIO(raw)) as img:
        img.draft("RGB", (160, 160))  # fast JPEG downscale; no-op for other formats
        if img.mode in ("RGBA", "LA", "P"):
            rgba = img.convert("RGBA")
            canvas = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
            img = Image.alpha_composite(canvas, rgba)
        img = img.convert("RGB")
        img.thumbnail((96, 96))
        method = getattr(getattr(Image, "Quantize", None), "MEDIANCUT", 0)
        quantized = img.quantize(colors=k, method=method)
        pal = quantized.getpalette() or []
        counts = sorted(quantized.getcolors() or [], reverse=True)

    total = sum(c for c, _ in counts) or 1
    out = []
    for count, idx in counts:
        r, g, b = pal[idx * 3: idx * 3 + 3]
        out.append({"hex": rgb_to_hex((r, g, b)), "share": round(count / total, 4)})
    return out


def run_deterministic_wcag_checks(
    fg_hex: str,
    bg_hex: str,
    has_alt_text: bool,
    alt_text: str,
    image_b64: str | None,
    manifest: dict,
) -> dict:
    """
    Returns {
      "contrast_ratio": float,            # floored to 2dp (never rounds a fail up to a pass)
      "wcag_level": "AAA" | "AA" | "FAIL",
      "flags": list[dict],                # ViolationItem-shaped
      "dominant_colors": list[dict],      # extra: handed to the Claude vision agent in Block 2
    }
    Rule IDs: WCAG-01 contrast, WCAG-02 alt text, PALETTE-01 off-brand color, IMG-01 undecodable image.
    """
    flags: list[dict] = []
    dominant_colors: list[dict] = []
    min_ratio = float(manifest.get("wcag_min_ratio", WCAG_AA))
    palette = []
    for hx in manifest.get("approved_hex_palette", []):
        rgb = hex_to_rgb(hx)
        if rgb is not None:
            palette.append((rgb_to_hex(rgb), rgb))

    fg_rgb, bg_rgb = hex_to_rgb(fg_hex), hex_to_rgb(bg_hex)
    ratio_out, level = 0.0, "FAIL"

    # ---- Contrast -----------------------------------------------------------
    if fg_rgb is None or bg_rgb is None:
        bad = [v for v, rgb in ((fg_hex, fg_rgb), (bg_hex, bg_rgb)) if rgb is None]
        flags.append(_flag(
            "ACCESSIBILITY", "WCAG-01", CIT_CONTRAST, ", ".join(str(b) for b in bad),
            "Color value is not a valid hex code, so contrast cannot be verified.",
            "Provide colors as #RRGGBB.", "MEDIUM",
        ))
    else:
        raw = contrast_ratio(fg_rgb, bg_rgb)
        ratio_out = math.floor(raw * 100) / 100
        level = "AAA" if raw >= WCAG_AAA else "AA" if raw >= WCAG_AA else "FAIL"

        if raw < min_ratio:
            fg_n, bg_n = rgb_to_hex(fg_rgb), rgb_to_hex(bg_rgb)
            suggestion = _suggest_foreground(fg_rgb, bg_rgb, palette, min_ratio)
            flags.append(_flag(
                "ACCESSIBILITY", "WCAG-01", CIT_CONTRAST, f"{fg_n} on {bg_n}",
                f"Contrast ratio is {ratio_out}:1, below the required {min_ratio}:1 for body text "
                f"(3:1 applies only to large text).",
                f"Change foreground {fg_n} to {suggestion}",
                "MEDIUM",
            ))

        # ---- Palette adherence (FG / BG) -----------------------------------
        if palette:
            for label, rgb in (("foreground", fg_rgb), ("background", bg_rgb)):
                nearest, dist = _nearest_palette(rgb, palette)
                if dist > PALETTE_TOLERANCE_UI:
                    hx = rgb_to_hex(rgb)
                    flags.append(_flag(
                        "ACCESSIBILITY", "PALETTE-01", CIT_PALETTE, hx,
                        f"The {label} color {hx} is not in the approved palette.",
                        f"Replace {hx} with approved {nearest}", "LOW",
                    ))

    # ---- Alt text -------------------------------------------------------------
    alt = (alt_text or "").strip()
    if not has_alt_text or (image_b64 and not alt):
        flags.append(_flag(
            "ACCESSIBILITY", "WCAG-02", CIT_ALT_TEXT, "[alt text missing]",
            "Non-text content requires a text alternative for screen-reader users.",
            "Add concise alt text describing the image's message (not just 'image').", "MEDIUM",
        ))
    elif alt:
        normalized = _FILENAME_RX.sub("", alt.lower()).strip(" .:-_")
        if normalized in _GENERIC_ALT or len(normalized) < 4 or _FILENAME_RX.search(alt):
            flags.append(_flag(
                "ACCESSIBILITY", "WCAG-02", CIT_ALT_TEXT, alt,
                "Alt text is generic or a filename and does not convey the image's meaning.",
                "Describe what the image communicates, e.g. 'Dashboard showing settlement times by region'.",
                "LOW",
            ))

    # ---- Image dominant colors ------------------------------------------------
    if image_b64:
        try:
            dominant_colors = _extract_dominant_colors(image_b64)
        except Exception as exc:
            logger.warning("Image analysis failed: %s", exc)
            flags.append(_flag(
                "ACCESSIBILITY", "IMG-01", CIT_IMAGE, "[image unreadable]",
                "The uploaded image could not be decoded, so visual checks were skipped.",
                "Re-export the image as PNG or JPEG and resubmit.", "MEDIUM",
            ))
        else:
            if palette:
                offbrand = 0
                for dom in dominant_colors:
                    if dom["share"] < IMAGE_MIN_SHARE or offbrand >= IMAGE_MAX_OFFBRAND_FLAGS:
                        continue
                    rgb = hex_to_rgb(dom["hex"])
                    nearest, dist = _nearest_palette(rgb, palette)
                    if dist > PALETTE_TOLERANCE_IMAGE:
                        offbrand += 1
                        flags.append(_flag(
                            "ACCESSIBILITY", "PALETTE-01", CIT_PALETTE, dom["hex"],
                            f"Dominant image color {dom['hex']} covers ~{round(dom['share'] * 100)}% of the "
                            f"image and is outside the approved palette.",
                            f"Replace {dom['hex']} with approved {nearest}", "LOW",
                        ))

    return {
        "contrast_ratio": ratio_out,
        "wcag_level": level,
        "flags": flags,
        "dominant_colors": dominant_colors,
    }


# -----------------------------------------------------------------------------
# Smoke test:  python deterministic.py
# -----------------------------------------------------------------------------
if __name__ == "__main__":
    import json
    import time

    from models import DEFAULT_BRAND_MANIFEST as MANIFEST

    sample = (
        "Meet the #1 fastest in the world payments platform. Enjoy RISK-FREE returns, "
        "zero fees forever, and instant global settlement. A revolutionary tool with "
        "100% guaranteed ROI for every deposit."
    )

    run_deterministic_text_checks(sample, MANIFEST)  # warm-up: compiles regex once
    runs = 1000
    t0 = time.perf_counter()
    for _ in range(runs):
        text_flags = run_deterministic_text_checks(sample, MANIFEST)
    text_ms = (time.perf_counter() - t0) / runs * 1000

    t0 = time.perf_counter()
    wcag = run_deterministic_wcag_checks("#94A3B8", "#F8FAFC", False, "", None, MANIFEST)
    wcag_ms = (time.perf_counter() - t0) * 1000

    print(f"Text flags: {len(text_flags)} | avg {text_ms:.3f} ms")
    for f in text_flags:
        print(f"  [{f['severity']:<14}] {f['rule_id']:<8} {f['exact_quote']!r} -> {f['surgical_fix']!r}")
        assert sample.find(f["exact_quote"]) != -1, "exact_quote must be a true substring"
    print(f"WCAG: ratio={wcag['contrast_ratio']} level={wcag['wcag_level']} flags={len(wcag['flags'])} | {wcag_ms:.3f} ms")
    print(json.dumps(wcag["flags"][:1], indent=2))
    print(f"Combined pre-flight ≈ {text_ms + wcag_ms:.3f} ms (budget: 10 ms)")
