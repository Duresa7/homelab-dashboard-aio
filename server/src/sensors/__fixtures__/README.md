# Sensor parser fixtures — PROVISIONAL

These `sensors -j` / `lsblk -J` payloads are **synthesized** from the vendor
family tables and known chip envelopes in `../parse.js` — they are *not* real
captures yet. They are correct in shape and exercise every chip branch, but a
future pass should **replace them with real captured stdout** from the actual
hosts:

```sh
sensors -j                                  > sensors-<host>.json
lsblk -J -o NAME,PATH,MODEL,VENDOR,SERIAL,TRAN,TYPE > lsblk-<host>.json
```

Drop the real captures in here and point `parse.test.js` at them; the
assertions should hold unchanged (or reveal a real-world envelope the parser
doesn't yet handle — which is exactly the regression this test exists to catch).
