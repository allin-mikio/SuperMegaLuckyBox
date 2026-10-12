import json
import urllib.request

url = "https://script.google.com/macros/s/AKfycbzLA9TgWObDfKY6NmdRX2rdqGuOmknZN7d6uSaZuDZPQHmUpHt9FAh5lvxFtmNHY5w2gA/exec"
body = json.dumps(
    {"team": "A", "board": 22, "token": 0, "moon": 0, "total": 22, "sheet": "Scores", "start_row": 2}
).encode()
req = urllib.request.Request(
    url,
    data=body,
    method="POST",
    headers={"Content-Type": "text/plain;charset=utf-8"},
)
with urllib.request.urlopen(req, timeout=60) as r:
    print("final URL:", r.geturl())
    print("status:", r.status)
    for k, v in r.headers.items():
        if "access-control" in k.lower() or "origin" in k.lower():
            print(f"{k}: {v}")
    print("body:", r.read()[:300].decode())
