"""
Run ONCE from the project folder:   python add_logout_confirm.py
Adds <script src="logout-confirm.js"></script> before </body> in every page
that has a Log out button. Safe to run again (it skips files already done).
"""
import os

FILES = ["index.html", "about.html", "event.html", "facilities.html",
         "governance.html", "notice.html", "schemes.html", "secretary.html"]
TAG = b'<script src="logout-confirm.js"></script>'

if not os.path.exists("logout-confirm.js"):
    raise SystemExit("logout-confirm.js not found. Put it in this folder first.")

for name in FILES:
    if not os.path.exists(name):
        print("MISSING :", name)
        continue
    data = open(name, "rb").read()
    if TAG in data:
        print("already :", name)
        continue
    i = data.rfind(b"</body>")
    if i == -1:
        print("no </body>:", name)
        continue
    nl = b"\r\n" if b"\r\n" in data else b"\n"
    data = data[:i] + TAG + nl + data[i:]
    open(name, "wb").write(data)
    print("updated :", name)
