"""
PQ Trader — Complete Item Catalog & Drop Source Exporter
Reads C:\\code\\eqpetfinder\\quarm.db in read-only mode and exports:
1. public/data/items_catalog.json — All 26,972 items (16,978 tradeable + 9,994 No-Drop) with stats & top NPC drop sources.
2. src/data/tradeable_lookup.json — Pre-normalized lookup index of tradeable items for the auction parser & BZR resolver.
"""

import sqlite3
import json
import os
import re
import sys

DB_PATH = r"C:\code\eqpetfinder\quarm.db"
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PUBLIC_DATA_DIR = os.path.join(PROJECT_ROOT, "public", "data")
SRC_DATA_DIR = os.path.join(PROJECT_ROOT, "src", "data")

os.makedirs(PUBLIC_DATA_DIR, exist_ok=True)
os.makedirs(SRC_DATA_DIR, exist_ok=True)

if not os.path.exists(DB_PATH):
    print(f"Error: quarm.db not found at {DB_PATH}")
    sys.exit(1)

conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

def clean_npc_name(raw_name: str) -> str:
    if not raw_name:
        return ""
    name = raw_name.lstrip("#")
    return name.replace("_", " ")

def normalize_item_name(name: str) -> str:
    """Normalize item name for case-insensitive and punctuation-tolerant matching."""
    s = name.lower().strip()
    s = s.replace("`", "'")
    s = re.sub(r"\s+", " ", s)
    return s

def export_catalog():
    print("[1/3] Querying top NPC loot drop sources per item from quarm.db...")
    cur.execute("""
        SELECT
            lde.item_id,
            n.name AS npc_name,
            n.level AS npc_level,
            s.zone AS zone_short,
            lte.probability AS group_prob,
            lde.chance AS item_chance
        FROM lootdrop_entries lde
        JOIN loottable_entries lte ON lde.lootdrop_id = lte.lootdrop_id
        JOIN npc_types n ON n.loottable_id = lte.loottable_id
        JOIN spawnentry se ON n.id = se.npcID
        JOIN spawn2 s ON se.spawngroupID = s.spawngroupID
        WHERE lte.probability > 0 AND lde.chance > 0
        GROUP BY lde.item_id, n.name, s.zone
    """)

    drops_by_item = {}
    for r in cur.fetchall():
        iid = r["item_id"]
        rate = round((r["group_prob"] / 100.0) * (r["item_chance"] if r["item_chance"] <= 100 else 100), 1)
        if iid not in drops_by_item:
            drops_by_item[iid] = []
        drops_by_item[iid].append({
            "npc": clean_npc_name(r["npc_name"]),
            "lvl": r["npc_level"],
            "zone": r["zone_short"],
            "rate": rate
        })

    # Keep top 5 highest-rate drop sources per item to keep JSON compact
    for iid in drops_by_item:
        drops_by_item[iid].sort(key=lambda x: (-x["rate"], x["npc"]))
        drops_by_item[iid] = drops_by_item[iid][:5]

    print(f"  -> Found drop sources for {len(drops_by_item):,d} items.")

    print("[2/3] Querying all 26,972 items from quarm.db...")
    cur.execute("""
        SELECT
            id, Name, itemtype, itemclass,
            ac, hp, mana, damage, delay, range,
            astr, asta, aagi, adex, awis, aint, acha,
            mr, fr, cr, dr, pr,
            classes, races, slots,
            reqlevel, reclevel,
            magic, nodrop, norent, lore,
            icon, weight, size,
            bagtype, bagslots, bagsize, bagwr,
            elemdmgtype, elemdmgamt,
            banedmgamt, banedmgbody, banedmgrace,
            skillmodtype, skillmodvalue,
            clickname, procname, wornname, focusname, scrollname, bardname,
            scrolleffect, clickeffect, proceffect, worneffect, focuseffect
        FROM items
        ORDER BY id ASC
    """)

    catalog = {}
    tradeable_by_norm_name = {}
    all_by_norm_name = {}
    tradeable_count = 0
    nodrop_count = 0

    for r in cur.fetchall():
        iid = r["id"]
        name = (r["Name"] or "").strip()
        if not name:
            continue

        # In EQEmu/Quarm: nodrop == 0 means NO DROP; nodrop != 0 means Tradeable
        is_nodrop = (r["nodrop"] == 0)
        if is_nodrop:
            nodrop_count += 1
        else:
            tradeable_count += 1

        item = {
            "id": iid,
            "name": name,
        }
        if is_nodrop:
            item["nodrop"] = True
        # In Quarm DB: lore string starting with '*' or lore != 0? Let's check lore column and lore string
        # Wait: in export_quarm_data.py, r["norent"] == 0 is norent, r["magic"] > 0 is magic
        if r["magic"] and r["magic"] > 0:
            item["magic"] = True
        if r["norent"] == 0:
            item["norent"] = True
        if r["lore"] and str(r["lore"]).startswith("*"):
            item["lore"] = True
        if r["lore"] and str(r["lore"]).strip():
            item["loreText"] = str(r["lore"]).lstrip("*").strip()

        if r["icon"] and r["icon"] > 0:
            item["icon"] = r["icon"]
        if r["itemtype"] is not None and r["itemtype"] >= 0:
            item["itemtype"] = r["itemtype"]
        if r["slots"] and r["slots"] > 0:
            item["slots"] = r["slots"]
        if r["classes"] and r["classes"] > 0:
            item["classes"] = r["classes"]
        if r["races"] and r["races"] > 0:
            item["races"] = r["races"]

        # Combat & Primary Stats
        if r["ac"] and r["ac"] != 0: item["ac"] = r["ac"]
        if r["hp"] and r["hp"] != 0: item["hp"] = r["hp"]
        if r["mana"] and r["mana"] != 0: item["mana"] = r["mana"]
        if r["damage"] and r["damage"] > 0: item["damage"] = r["damage"]
        if r["delay"] and r["delay"] > 0: item["delay"] = r["delay"]
        if r["range"] and r["range"] > 0: item["range"] = r["range"]

        # Heroic/Base Attributes
        if r["astr"] and r["astr"] != 0: item["str"] = r["astr"]
        if r["asta"] and r["asta"] != 0: item["sta"] = r["asta"]
        if r["aagi"] and r["aagi"] != 0: item["agi"] = r["aagi"]
        if r["adex"] and r["adex"] != 0: item["dex"] = r["adex"]
        if r["awis"] and r["awis"] != 0: item["wis"] = r["awis"]
        if r["aint"] and r["aint"] != 0: item["int"] = r["aint"]
        if r["acha"] and r["acha"] != 0: item["cha"] = r["acha"]

        # Saves / Resists
        if r["mr"] and r["mr"] != 0: item["mr"] = r["mr"]
        if r["fr"] and r["fr"] != 0: item["fr"] = r["fr"]
        if r["cr"] and r["cr"] != 0: item["cr"] = r["cr"]
        if r["dr"] and r["dr"] != 0: item["dr"] = r["dr"]
        if r["pr"] and r["pr"] != 0: item["pr"] = r["pr"]

        # Level & Physical properties
        if r["reqlevel"] and r["reqlevel"] > 0: item["reqlevel"] = r["reqlevel"]
        if r["reclevel"] and r["reclevel"] > 0: item["reclevel"] = r["reclevel"]
        if r["weight"] and r["weight"] > 0: item["weight"] = round(r["weight"] / 10.0, 1)
        if r["size"] is not None and r["size"] >= 0: item["size"] = r["size"]

        # Container properties
        if r["bagslots"] and r["bagslots"] > 0:
            item["bagslots"] = r["bagslots"]
            item["bagsize"] = r["bagsize"]
            if r["bagwr"] and r["bagwr"] > 0:
                item["bagwr"] = r["bagwr"]

        # Elemental / Bane
        if r["elemdmgamt"] and r["elemdmgamt"] > 0:
            item["elemdmg"] = {"type": r["elemdmgtype"], "amt": r["elemdmgamt"]}
        if r["banedmgamt"] and r["banedmgamt"] > 0:
            item["banedmg"] = {"body": r["banedmgbody"], "race": r["banedmgrace"], "amt": r["banedmgamt"]}

        # Effects
        if r["clickname"]: item["click"] = r["clickname"]
        if r["procname"]: item["proc"] = r["procname"]
        if r["wornname"]: item["worn"] = r["wornname"]
        if r["focusname"]: item["focus"] = r["focusname"]
        if r["scrollname"]: item["scroll"] = r["scrollname"]

        # Drop sources
        if iid in drops_by_item:
            item["drops"] = drops_by_item[iid]

        catalog[str(iid)] = item

        norm = normalize_item_name(name)
        # Score candidate:
        # 1) Prefer tradeable over nodrop when two items have the exact same name
        # 2) Prefer items that actually drop from spawned NPCs (e.g. #11551 Shield of the Immaculate over #999)
        # 3) Prefer matching lore and standard IDs >= 1000
        is_tradeable_score = 0 if is_nodrop else 1
        has_drops = 1 if iid in drops_by_item else 0
        lore_str = str(r["lore"] or "").lstrip("*").strip().lower()
        exact_lore = 1 if lore_str == name.lower() else 0
        non_test_id = 1 if iid >= 1000 else 0
        cand_score = (is_tradeable_score, has_drops, exact_lore, non_test_id, -iid)

        if norm not in all_by_norm_name or cand_score > all_by_norm_name[norm]["_score"]:
            all_by_norm_name[norm] = {"id": iid, "_score": cand_score}

        if norm not in tradeable_by_norm_name or cand_score > tradeable_by_norm_name[norm]["_score"]:
            tradeable_by_norm_name[norm] = {
                "id": iid,
                "name": name,
                "isSpell": name.lower().startswith("spell:") or name.lower().startswith("song:") or (r["itemtype"] == 20),
                "nodrop": is_nodrop,
                "_score": cand_score,
            }

    # Strip internal _score before serializing
    clean_tradeable = {
        k: {
            "id": v["id"],
            "name": v["name"],
            "isSpell": v["isSpell"],
            **({"nodrop": True} if v.get("nodrop") else {})
        }
        for k, v in tradeable_by_norm_name.items()
    }
    clean_all = {k: v["id"] for k, v in all_by_norm_name.items()}

    catalog_path = os.path.join(PUBLIC_DATA_DIR, "items_catalog.json")
    with open(catalog_path, "w", encoding="utf-8") as f:
        json.dump(catalog, f, separators=(",", ":"))

    lookup_path = os.path.join(SRC_DATA_DIR, "tradeable_lookup.json")
    with open(lookup_path, "w", encoding="utf-8") as f:
        json.dump({
            "tradeableByNormName": clean_tradeable,
            "allByNormName": clean_all
        }, f, separators=(",", ":"))

    cat_mb = os.path.getsize(catalog_path) / (1024 * 1024)
    lkp_mb = os.path.getsize(lookup_path) / (1024 * 1024)
    print(f"[3/3] Export complete!")
    print(f"  -> Total items exported: {len(catalog):,d} ({tradeable_count:,d} tradeable, {nodrop_count:,d} No-Drop)")
    print(f"  -> {catalog_path} ({cat_mb:.2f} MB)")
    print(f"  -> {lookup_path} ({lkp_mb:.2f} MB, {len(tradeable_by_norm_name):,d} unique tradeable names)")

if __name__ == "__main__":
    export_catalog()
