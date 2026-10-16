"""Recording timestamps: "MM:SS", or "H:MM:SS" past an hour."""


def valid(ts: str) -> bool:
    parts = ts.split(":")
    return 2 <= len(parts) <= 3 and all(p.isdigit() for p in parts)


def mmss(seconds: int) -> str:
    m, s = divmod(max(0, seconds), 60)
    return f"{m // 60}:{m % 60:02d}:{s:02d}" if m >= 60 else f"{m:02d}:{s:02d}"


def seconds(ts: str) -> int:
    """To seconds. Model-written stamps can be malformed: those sort last."""
    if not valid(ts):
        return 10**9
    n = 0
    for part in ts.split(":"):
        n = n * 60 + int(part)
    return n
