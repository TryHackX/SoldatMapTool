import argparse
import heapq
import math
import struct
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

# ==============================================================================
# SOLDAT POLYGON TYPES (.PMS)
# ==============================================================================
# 0: Normal                  | 1: Only Bullets Collide  | 2: Only Players Collide
# 3: No Collide              | 4: Ice                   | 5: Deadly
# 6: Bloody Deadly           | 7: Hurts                 | 8: Regenerates
# 9: Lava                    | 10: Alpha Bullets        | 11: Alpha Players
# 12: Bravo Bullets          | 13: Bravo Players        | 14: Charlie Bullets
# 15: Charlie Players        | 16: Delta Bullets        | 17: Delta Players
# 18: Bouncy                 | 19: Explosive            | 20: Hurts Flaggers
# 21: Flagger Collides       | 22: Non-Flagger Collides | 23: Flag Collides
# 24: Background             | 25: Background Transition
# ==============================================================================

# Polygons that stop the player (walls, floors, ice, bouncy)
SOLID_POLY_TYPES = {0, 2, 4, 7, 8, 18}

# Deadly polygons (obstacles, never counted as an area players can move in)
DEADLY_POLY_TYPES = {5, 6, 9, 19}

# Every polygon that stops the dots from spreading
BLOCKING_POLY_TYPES = SOLID_POLY_TYPES | DEADLY_POLY_TYPES

# Colors of special polygon types (as in Soldat analysis previews)
SPECIAL_POLY_COLORS = {
    1: (46, 139, 87),     # Only Bullets Collide - green
    2: (95, 135, 115),    # Only Players Collide
    4: (130, 185, 220),   # Ice - light blue
    5: (150, 42, 38),     # Deadly - red (e.g. stove burners)
    6: (135, 30, 30),     # Bloody Deadly
    7: (180, 90, 40),     # Hurts
    8: (60, 160, 110),    # Regenerates
    9: (175, 50, 35),     # Lava
    11: (160, 60, 60),    # Alpha Players
    13: (60, 100, 160),   # Bravo Players
    15: (160, 150, 60),   # Charlie Players
    17: (60, 150, 80),    # Delta Players
    18: (160, 70, 155),   # Bouncy - purple/pink
    19: (170, 60, 30),    # Explosive
    20: (150, 70, 90),    # Hurts Flaggers
    21: (55, 125, 140),   # Flagger Collides
    22: (55, 125, 140),   # Non-Flagger Collides
    23: (50, 125, 142),   # Flag Collides - turquoise
}

BG_COLOR = (20, 21, 26)


def read_shortstring(data: bytes, offset: int, max_len: int) -> tuple[str, int]:
    length = data[offset]
    text = data[offset + 1 : offset + 1 + min(length, max_len)].decode("cp1250", errors="replace")
    return text, offset + 1 + max_len


def parse_pms(filepath: str | Path) -> dict:
    """Parses a binary .pms file (Soldat Polygon Map System v11)."""
    data = Path(filepath).read_bytes()
    data_len = len(data)
    offset = 0

    version = struct.unpack_from("<i", data, offset)[0]
    offset += 4

    description, offset = read_shortstring(data, offset, 38)
    texture, offset = read_shortstring(data, offset, 24)

    bg_top = struct.unpack_from("<4B", data, offset)
    offset += 4
    bg_bottom = struct.unpack_from("<4B", data, offset)
    offset += 4

    jet_amount, grenades, medikits, weather, steps, rand_id = struct.unpack_from(
        "<iBBBBi", data, offset
    )
    offset += 12

    poly_count = struct.unpack_from("<i", data, offset)[0]
    offset += 4

    polygons = []
    for _ in range(poly_count):
        verts = []
        for _ in range(3):
            # .pms stores vertex colors as little-endian D3DCOLOR: B, G, R, A
            x, y, z, rhw, b, g, r, a, tu, tv = struct.unpack_from("<ffffBBBBff", data, offset)
            offset += 28
            verts.append((x, y, (r, g, b, a)))

        normals = []
        for _ in range(3):
            nx, ny, nz = struct.unpack_from("<fff", data, offset)
            offset += 12
            normals.append((nx, ny, nz))

        poly_type = struct.unpack_from("<B", data, offset)[0]
        offset += 1

        polygons.append({
            "verts": verts,
            "normals": normals,
            "type": poly_type,
        })

    # Sector grid: (2 * num_sectors + 1)^2 entries
    sector_division, num_sectors = struct.unpack_from("<ii", data, offset)
    offset += 8
    grid_count = (2 * num_sectors + 1) ** 2
    for _ in range(grid_count):
        sector_poly_count = struct.unpack_from("<H", data, offset)[0]
        offset += 2 + 2 * sector_poly_count

    # Props: 44 bytes per prop (packed record)
    prop_count = struct.unpack_from("<i", data, offset)[0]
    offset += 4 + prop_count * 44

    # Scenery: 55 bytes per entry (ShortString[50] = 51 B + DOSTime = 4 B)
    scenery_count = struct.unpack_from("<i", data, offset)[0]
    offset += 4 + scenery_count * 55

    # Colliders: 16 bytes per collider
    colliders = []
    if offset + 4 <= data_len:
        collider_count = struct.unpack_from("<i", data, offset)[0]
        offset += 4
        for _ in range(collider_count):
            if offset + 16 > data_len:
                break
            active, pad1, pad2, pad3, cx, cy, radius = struct.unpack_from("<BBBBfff", data, offset)
            offset += 16
            if active:
                colliders.append({"x": cx, "y": cy, "radius": radius})

    # Spawn points: 16 bytes per spawn
    spawns = []
    if offset + 4 <= data_len:
        spawn_count = struct.unpack_from("<i", data, offset)[0]
        offset += 4
        for _ in range(spawn_count):
            if offset + 16 > data_len:
                break
            # Active is 1 byte + 3 padding bytes (they may hold garbage from the editor's memory)
            active = data[offset] != 0
            sx, sy, team = struct.unpack_from("<iii", data, offset + 4)
            offset += 16
            if active:
                spawns.append({"x": float(sx), "y": float(sy), "team": team})

    return {
        "version": version,
        "description": description,
        "texture": texture,
        "jet_amount": jet_amount,
        "polygons": polygons,
        "colliders": colliders,
        "spawns": spawns,
    }


def get_poly_color(poly: dict) -> tuple[int, int, int]:
    """Polygon color from its type and the vertex colors stored in the .pms."""
    ptype = poly["type"]
    if ptype in SPECIAL_POLY_COLORS:
        return SPECIAL_POLY_COLORS[ptype]

    # Average vertex color (R, G, B) from the .pms
    r = sum(v[2][0] for v in poly["verts"]) // 3
    g = sum(v[2][1] for v in poly["verts"]) // 3
    b = sum(v[2][2] for v in poly["verts"]) // 3

    if ptype in SOLID_POLY_TYPES:
        # A plain wall with pure white vertex colors (under its texture) is toned down to the template grey
        if r > 215 and g > 215 and b > 215:
            return (105, 108, 115)
        # Very dark walls are lightened a little so they stand out from the background (20, 21, 26)
        if r < 35 and g < 35 and b < 35:
            return (85, 88, 95)
        return (int(r * 0.65 + 30), int(g * 0.65 + 30), int(b * 0.65 + 32))
    else:
        # Background polygons (No Collide / Background) keep their hue (e.g. a 3D frame, a fridge, a light bulb)
        if r == 0 and g == 0 and b == 0:
            return BG_COLOR
        return (int(r * 0.72), int(g * 0.72), int(b * 0.75))


def compute_reachable_grid(
    blocked_mask: np.ndarray,
    spawns_px: list[tuple[int, int, int]],
    step_px: int,
    max_climb_px: float,
    clearance_px: int = 2,
) -> list[tuple[int, int]]:
    """
    Grid points (every `step_px` pixels) reachable from the spawns.
    Accounts for gravity, standing on platforms and the jetpack flight height limit.
    """
    h, w = blocked_mask.shape
    gh = h // step_px
    gw = w // step_px

    # Check the surroundings of every grid point
    grid_blocked = np.zeros((gh, gw), dtype=bool)
    for gy in range(gh):
        py = gy * step_px
        y0 = max(0, py - clearance_px)
        y1 = min(h, py + clearance_px + 1)
        for gx in range(gw):
            px = gx * step_px
            x0 = max(0, px - clearance_px)
            x1 = min(w, px + clearance_px + 1)
            if blocked_mask[y0:y1, x0:x1].any():
                grid_blocked[gy, gx] = True

    # Check the whole segment between nodes (stops passing through walls thinner than step_px)
    def can_step(gy1: int, gx1: int, gy2: int, gx2: int) -> bool:
        if not (0 <= gy2 < gh and 0 <= gx2 < gw) or grid_blocked[gy2, gx2]:
            return False
        y1, x1 = gy1 * step_px, gx1 * step_px
        y2, x2 = gy2 * step_px, gx2 * step_px
        if y1 == y2:
            xa, xb = min(x1, x2), max(x1, x2)
            return not blocked_mask[y1, xa : xb + 1].any()
        else:
            ya, yb = min(y1, y2), max(y1, y2)
            return not blocked_mask[ya : yb + 1, x1].any()

    # "Supported" cells (right above a floor), where jumping and the jetpack recharge
    is_supported = np.zeros((gh, gw), dtype=bool)
    for gy in range(gh - 1):
        for gx in range(gw):
            if not grid_blocked[gy, gx]:
                y_start = gy * step_px
                y_end = min(h, (gy + 1) * step_px + clearance_px + 2)
                if blocked_mask[y_start:y_end, gx * step_px].any():
                    is_supported[gy, gx] = True

    best_alt = np.full((gh, gw), np.inf, dtype=np.float32)
    pq = []

    # Start only from the given spawns. The caller picks the Alpha and Bravo
    # spawns separately, so CTF maps never mix the two teams.
    for sx, sy, _ in spawns_px:
        sgx = sx // step_px
        sgy = sy // step_px
        found_seed = False
        for radius in range(4):
            for dy in range(-radius, radius + 1):
                for dx in range(-radius, radius + 1):
                    ny, nx = sgy + dy, sgx + dx
                    if 0 <= ny < gh and 0 <= nx < gw and not grid_blocked[ny, nx]:
                        if best_alt[ny, nx] > 0.0:
                            best_alt[ny, nx] = 0.0
                            heapq.heappush(pq, (0.0, ny, nx))
                        found_seed = True
            if found_seed:
                break

    # 4 directions of movement (no diagonal leaks through polygon corners)
    directions = [(-1, 0), (1, 0), (0, -1), (0, 1)]

    while pq:
        alt, gy, gx = heapq.heappop(pq)
        if alt > best_alt[gy, gx]:
            continue

        for dy, dx in directions:
            ny, nx = gy + dy, gx + dx
            if not can_step(gy, gx, ny, nx):
                continue

            if is_supported[ny, nx]:
                new_alt = 0.0
            elif dy < 0:
                new_alt = alt + step_px
            else:
                new_alt = max(0.0, alt - (step_px * 0.25 if dy > 0 else 0.0))

            if new_alt <= max_climb_px and new_alt < best_alt[ny, nx]:
                best_alt[ny, nx] = new_alt
                heapq.heappush(pq, (new_alt, ny, nx))

    reachable_points = []
    for gy in range(gh):
        for gx in range(gw):
            if best_alt[gy, gx] <= max_climb_px:
                reachable_points.append((gx * step_px, gy * step_px))

    return reachable_points


def render_map_and_dots(
    pms_data: dict,
    output_path: str | Path,
    target_width: int = 1920,
    step_px: int = 5,
    dot_radius: int = 1,
    clearance_px: int = 2,
    draw_dots: bool = True,
):
    polygons = pms_data["polygons"]
    if not polygons:
        raise ValueError("The map has no polygons.")

    all_x = [v[0] for p in polygons for v in p["verts"]]
    all_y = [v[1] for p in polygons for v in p["verts"]]
    min_x, max_x = min(all_x), max(all_x)
    min_y, max_y = min(all_y), max(all_y)

    margin_world = 40.0
    min_x -= margin_world
    max_x += margin_world
    min_y -= margin_world
    max_y += margin_world

    world_w = max_x - min_x
    world_h = max_y - min_y
    scale = target_width / world_w
    target_height = int(round(world_h * scale))

    def to_px(wx: float, wy: float) -> tuple[int, int]:
        return (
            int(round((wx - min_x) * scale)),
            int(round((wy - min_y) * scale)),
        )

    img = Image.new("RGB", (target_width, target_height), BG_COLOR)
    draw = ImageDraw.Draw(img)

    mask_img = Image.new("L", (target_width, target_height), 0)
    mask_draw = ImageDraw.Draw(mask_img)

    # 1. Polygons the player passes through (background, decoration, Only Bullets Collide, Flag Collides)
    for poly in polygons:
        if poly["type"] not in BLOCKING_POLY_TYPES:
            pts = [to_px(v[0], v[1]) for v in poly["verts"]]
            draw.polygon(pts, fill=get_poly_color(poly))

    # 2. Polygons that block the player (walls, floors, deadly) + a watertight collision mask
    for poly in polygons:
        if poly["type"] in BLOCKING_POLY_TYPES:
            pts = [to_px(v[0], v[1]) for v in poly["verts"]]
            draw.polygon(pts, fill=get_poly_color(poly))
            mask_draw.polygon(pts, fill=1, outline=1)

            # Normal ticks on the edges of colliding polygons
            for i in range(3):
                p1 = pts[i]
                p2 = pts[(i + 1) % 3]
                nx, ny, _ = poly["normals"][i]
                norm_len = math.hypot(nx, ny)
                if norm_len > 1e-5:
                    nx, ny = nx / norm_len, ny / norm_len
                    edge_len = math.hypot(p2[0] - p1[0], p2[1] - p1[1])
                    steps_count = max(1, int(edge_len // 18))
                    for s in range(1, steps_count + 1):
                        t = s / (steps_count + 1)
                        mx = p1[0] + (p2[0] - p1[0]) * t
                        my = p1[1] + (p2[1] - p1[1]) * t
                        draw.line(
                            [(mx, my), (mx + nx * 3.5, my + ny * 3.5)],
                            fill=(32, 34, 40),
                            width=1,
                        )

    # 3. Maximum climb height, including the jetpack
    jet_amount = max(0, pms_data["jet_amount"])
    max_climb_world = 48.0 + jet_amount * 3.2
    max_climb_px = max_climb_world * scale

    spawns_px = []
    for sp in pms_data["spawns"]:
        px, py = to_px(sp["x"], sp["y"])
        spawns_px.append((px, py, sp["team"]))

    # 4. Reachability for each CTF team separately.
    # Red = reachable from Alpha, blue = from Bravo, purple = both teams.
    blocked_mask = np.array(mask_img, dtype=bool)
    alpha_points = []
    bravo_points = []
    if draw_dots:
        alpha_spawns = [s for s in spawns_px if s[2] == 1]
        bravo_spawns = [s for s in spawns_px if s[2] == 2]
        alpha_points = compute_reachable_grid(
            blocked_mask=blocked_mask, spawns_px=alpha_spawns, step_px=step_px,
            max_climb_px=max_climb_px, clearance_px=clearance_px,
        ) if alpha_spawns else []
        bravo_points = compute_reachable_grid(
            blocked_mask=blocked_mask, spawns_px=bravo_spawns, step_px=step_px,
            max_climb_px=max_climb_px, clearance_px=clearance_px,
        ) if bravo_spawns else []

        alpha_set, bravo_set = set(alpha_points), set(bravo_points)
        both_set = alpha_set & bravo_set
        # The shared purple area is drawn last so nothing covers it.
        for points, color in ((alpha_set - both_set, (245, 75, 65)),
                              (bravo_set - both_set, (65, 155, 255)),
                              (both_set, (205, 95, 235))):
            for dx, dy in points:
                if dot_radius <= 0:
                    img.putpixel((dx, dy), color)
                else:
                    draw.ellipse([dx - dot_radius, dy - dot_radius,
                                  dx + dot_radius, dy + dot_radius], fill=color)
        reachable_dots = alpha_set | bravo_set
    else:
        reachable_dots = set()

    # 5. Spawn and flag markers
    spawn_colors = {
        0: (220, 220, 220),  # General
        1: (235, 65, 50),    # Alpha Spawn (red square)
        2: (50, 145, 240),   # Bravo Spawn (blue square)
        3: (235, 210, 50),   # Charlie Spawn
        4: (60, 215, 90),    # Delta Spawn
        5: (235, 65, 50),    # Alpha Flag (red circle)
        6: (50, 145, 240),   # Bravo Flag (blue circle)
    }

    for px, py, team in spawns_px:
        if team not in spawn_colors:
            continue
        scolor = spawn_colors[team]
        if team in (5, 6):
            draw.ellipse([px - 8, py - 8, px + 8, py + 8], outline=scolor, width=1)
            draw.ellipse([px - 1, py - 1, px + 1, py + 1], fill=scolor)
        else:
            draw.rectangle([px - 3, py - 3, px + 3, py + 3], outline=scolor, width=1)

    img.save(output_path)
    print(
        f"[OK] Map: {pms_data['description']} | Polygons: {len(polygons)} | "
        f"Colliders: {len(pms_data['colliders'])} | Spawns: {len(spawns_px)} | "
        f"Jet: {jet_amount} | Reachable: Alpha={len(alpha_points)}, Bravo={len(bravo_points)}, "
        f"total={len(reachable_dots)} (every {step_px}px) -> {output_path}"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Renders a Soldat map (.pms) template with separate Alpha / Bravo reachability zones for CTF."
    )
    parser.add_argument("pms_file", help="Path to the .pms map file")
    parser.add_argument("-o", "--output", default="map_template_dots.png", help="Output .png file")
    parser.add_argument("--step", type=int, default=5, help="Dot spacing in pixels (default: 5)")
    parser.add_argument("--width", type=int, default=1920, help="Output image width in px (default: 1920)")
    parser.add_argument("--dot-radius", type=int, default=0, help="Dot radius in px (default: 0 = a single pixel, 1 = 3x3 px)")
    parser.add_argument("--clearance", type=int, default=2, help="Dot clearance from walls in px (default: 2)")
    parser.add_argument("--no-dots", action="store_true", help="Render only the clean template, without dots")

    args = parser.parse_args()
    data = parse_pms(args.pms_file)
    render_map_and_dots(
        pms_data=data,
        output_path=args.output,
        target_width=args.width,
        step_px=args.step,
        dot_radius=args.dot_radius,
        clearance_px=args.clearance,
        draw_dots=not args.no_dots,
    )