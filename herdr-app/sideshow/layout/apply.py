#!/usr/bin/env python3
"""Make `main-sideshow` from Herdr's shipped `main` layout (task-46-15).

Usage: apply.py [~/.config/herdr-app]

Reads <home>/layouts/main.json (Herdr rewrites it on every start, so it is always
the shipped one) and writes <home>/layouts/main-sideshow.json with one change:
the tab bar block (`tabs`) sits in a row with small button blocks after it:
`herdra-button` (the Herdra attention window, task-46-5), `usage-button` (Herdra's own
Usage popup, herdr-app/usage; only once <home>/mods/usage exists) and `sideshow-button`. Each
button toggles its floating window; nothing resizes the terminals. With <home>/mods/alerts installed
(herdr-app/alerts, task-59) the row also ends in a 0px `alerts` block: it draws nothing and only
watches agents to forward Herdr's alerts to Hokum. Everything else, including the shipped tabs, files, changes, sidebar
and status mods, is Herdr's and keeps updating. It also saves the shipped file as
the drift check's base (herdr-app/sideshow/layout/main.base.json).
"""
import json
import os
import shutil
import subprocess
import sys

# The tab row's buttons, left to right: (block id, mod, width px). Usage is Herdra's own
# mod (herdr-app/usage) and joins only once it is installed (a layout naming a missing mod fails).
BUTTONS = [("herdra-button", "herdra", 100), ("usage-button", "usage", 80), ("sideshow-button", "sideshow", 104)]
# The 0px listener block (herdr-app/alerts), last in the tab row; joins only once its mod is installed.
LISTENER = ("alerts-listener", "alerts")
HERE = os.path.dirname(os.path.abspath(__file__))


def find(node, id_):
    if node.get("id") == id_:
        return node
    for child in node.get("children", []):
        hit = find(child, id_)
        if hit:
            return hit
    return None


def parent_of(node, id_):
    for child in node.get("children", []):
        if child.get("id") == id_:
            return node
        hit = parent_of(child, id_)
        if hit:
            return hit
    return None


def build(layout, version, installed):
    tabs = find(layout, "tabs")
    if not tabs:
        sys.exit("Herdr's main layout has no `tabs` block any more: rethink the button's place")
    holder = parent_of(layout, "tabs")
    i = holder["children"].index(tabs)
    height = tabs.get("size", {"px": 42})
    tabs["size"] = {"weight": 1}
    holder["children"][i] = {
        "id": "tab-row", "type": "row", "size": height, "resizable": False, "background": "chrome",
        "children": [tabs] + [{"id": id_, "type": "block", "size": {"px": px},
                               "content": {"mod": mod, "props": {"button": True}}}
                              for id_, mod, px in BUTTONS if mod in installed]
                  + ([{"id": LISTENER[0], "type": "block", "size": {"px": 0}, "content": {"mod": LISTENER[1]}}]
                     if LISTENER[1] in installed else []),
    }
    layout["cloned_from"] = {"name": "main", "version": version}
    return layout


def main():
    home = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/.config/herdr-app")
    shipped = os.path.join(home, "layouts", "main.json")
    out = os.path.join(home, "layouts", "main-sideshow.json")
    version = subprocess.run(["herdr-app", "--version"], capture_output=True, text=True).stdout.split()[-1]
    installed = set(os.listdir(os.path.join(home, "mods")))
    layout = build(json.load(open(shipped)), version, installed)
    tmp = out + ".tmp"
    with open(tmp, "w") as f:
        json.dump(layout, f, indent=2)
        f.write("\n")
    os.replace(tmp, out)
    shutil.copyfile(shipped, os.path.join(HERE, "main.base.json"))
    buttons = ", ".join(mod for _, mod, _ in BUTTONS if mod in installed)
    listener = "; listener: alerts" if LISTENER[1] in installed else ""
    print(f"wrote {out} from {shipped} (herdr-app {version}); buttons: {buttons}{listener}")


if __name__ == "__main__":
    main()
