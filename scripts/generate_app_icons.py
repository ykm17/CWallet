import math
import os
import re
import subprocess
import shutil

# Material Community Icon 'wallet' path
WALLET_SVG_PATH = (
    'M21,18V19A2,2 0 0,1 19,21H5C3.89,21 3,20.1 3,19V5A2,2 0 0,1 5,3H19A2,2 0 0,1 '
    '21,5V6H12C10.89,6 10,6.9 10,8V16A2,2 0 0,0 12,18M12,16H22V8H12M16,13.5A1.5,1.5 '
    '0 0,1 14.5,12A1.5,1.5 0 0,1 16,10.5A1.5,1.5 0 0,1 17.5,12A1.5,1.5 0 0,1 16,13.5Z'
)

def arc_to_beziers(x1, y1, rx, ry, phi, fa, fs, x2, y2):
    rx, ry = abs(rx), abs(ry)
    phi_rad = math.radians(phi)
    cos_phi, sin_phi = math.cos(phi_rad), math.sin(phi_rad)
    dx, dy = (x1 - x2) / 2.0, (y1 - y2) / 2.0
    x1p, y1p = cos_phi * dx + sin_phi * dy, -sin_phi * dx + cos_phi * dy
    prx, pry = rx * rx, ry * ry
    px1, py1 = x1p * x1p, y1p * y1p
    radii_check = px1 / prx + py1 / pry
    if radii_check > 1.0:
        s = math.sqrt(radii_check)
        rx, ry = rx * s, ry * s
        prx, pry = rx * rx, ry * ry
    sign = -1.0 if fa == fs else 1.0
    sq = max(0.0, ((prx * pry) - (prx * py1) - (pry * px1)) / ((prx * py1) + (pry * px1)))
    coef = sign * math.sqrt(sq)
    cxp, cyp = coef * ((rx * y1p) / ry), coef * (-(ry * x1p) / rx)
    cx, cy = cos_phi * cxp - sin_phi * cyp + (x1 + x2) / 2.0, sin_phi * cxp + cos_phi * cyp + (y1 + y2) / 2.0

    def vector_angle(ux, uy, vx, vy):
        dot = max(-1.0, min(1.0, (ux * vx + uy * vy) / (math.sqrt(ux * ux + uy * uy) * math.sqrt(vx * vx + vy * vy))))
        ang = math.acos(dot)
        if (ux * vy - uy * vx) < 0:
            ang = -ang
        return ang

    theta1 = vector_angle(1.0, 0.0, (x1p - cxp) / rx, (y1p - cyp) / ry)
    dtheta = vector_angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
    if not fs and dtheta > 0:
        dtheta -= 2 * math.pi
    elif fs and dtheta < 0:
        dtheta += 2 * math.pi
    segments = max(1, math.ceil(abs(dtheta) / (math.pi / 2.0)))
    delta = dtheta / segments
    t = 8.0 / 3.0 * math.sin(delta / 4.0) * math.sin(delta / 4.0) / math.sin(delta / 2.0)
    curves = []
    curr_theta, curr_x, curr_y = theta1, x1, y1
    for _ in range(segments):
        next_theta = curr_theta + delta
        cos_t1, sin_t1 = math.cos(curr_theta), math.sin(curr_theta)
        cos_t2, sin_t2 = math.cos(next_theta), math.sin(next_theta)
        ep_x = cos_phi * rx * cos_t2 - sin_phi * ry * sin_t2 + cx
        ep_y = sin_phi * rx * cos_t2 + cos_phi * ry * sin_t2 + cy
        dx1, dy1 = -cos_phi * rx * sin_t1 - sin_phi * ry * cos_t1, -sin_phi * rx * sin_t1 + cos_phi * ry * cos_t1
        dx2, dy2 = -cos_phi * rx * sin_t2 - sin_phi * ry * cos_t2, -sin_phi * rx * sin_t2 + cos_phi * ry * cos_t2
        curves.append((curr_x + t * dx1, curr_y + t * dy1, ep_x - t * dx2, ep_y - t * dy2, ep_x, ep_y))
        curr_theta, curr_x, curr_y = next_theta, ep_x, ep_y
    return curves

def svg_to_pdf_ops(d):
    tokens = re.findall(r'([a-zA-Z]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?)', d)
    ops = []
    i = 0
    curr_x, curr_y = 0.0, 0.0
    start_x, start_y = 0.0, 0.0
    cmd = ''
    while i < len(tokens):
        t = tokens[i]
        if t.isalpha():
            cmd = t
            i += 1
        if cmd == 'M':
            curr_x, curr_y = float(tokens[i]), float(tokens[i+1])
            start_x, start_y = curr_x, curr_y
            ops.append(f'{curr_x:.4f} {curr_y:.4f} m')
            i += 2
            cmd = 'L'
        elif cmd == 'm':
            curr_x += float(tokens[i])
            curr_y += float(tokens[i+1])
            start_x, start_y = curr_x, curr_y
            ops.append(f'{curr_x:.4f} {curr_y:.4f} m')
            i += 2
            cmd = 'l'
        elif cmd == 'L':
            curr_x, curr_y = float(tokens[i]), float(tokens[i+1])
            ops.append(f'{curr_x:.4f} {curr_y:.4f} l')
            i += 2
        elif cmd == 'l':
            curr_x += float(tokens[i])
            curr_y += float(tokens[i+1])
            ops.append(f'{curr_x:.4f} {curr_y:.4f} l')
            i += 2
        elif cmd == 'H':
            curr_x = float(tokens[i])
            ops.append(f'{curr_x:.4f} {curr_y:.4f} l')
            i += 1
        elif cmd == 'h':
            curr_x += float(tokens[i])
            ops.append(f'{curr_x:.4f} {curr_y:.4f} l')
            i += 1
        elif cmd == 'V':
            curr_y = float(tokens[i])
            ops.append(f'{curr_x:.4f} {curr_y:.4f} l')
            i += 1
        elif cmd == 'v':
            curr_y += float(tokens[i])
            ops.append(f'{curr_x:.4f} {curr_y:.4f} l')
            i += 1
        elif cmd == 'C':
            cp1_x, cp1_y = float(tokens[i]), float(tokens[i+1])
            cp2_x, cp2_y = float(tokens[i+2]), float(tokens[i+3])
            curr_x, curr_y = float(tokens[i+4]), float(tokens[i+5])
            ops.append(f'{cp1_x:.4f} {cp1_y:.4f} {cp2_x:.4f} {cp2_y:.4f} {curr_x:.4f} {curr_y:.4f} c')
            i += 6
        elif cmd == 'A':
            rx, ry = float(tokens[i]), float(tokens[i+1])
            phi, fa, fs = float(tokens[i+2]), int(float(tokens[i+3])), int(float(tokens[i+4]))
            x2, y2 = float(tokens[i+5]), float(tokens[i+6])
            beziers = arc_to_beziers(curr_x, curr_y, rx, ry, phi, fa, fs, x2, y2)
            for cp1x, cp1y, cp2x, cp2y, epx, epy in beziers:
                ops.append(f'{cp1x:.4f} {cp1y:.4f} {cp2x:.4f} {cp2y:.4f} {epx:.4f} {epy:.4f} c')
            curr_x, curr_y = x2, y2
            i += 7
        elif cmd in ('Z', 'z'):
            ops.append('h')
            curr_x, curr_y = start_x, start_y
            cmd = ''
        else:
            i += 1
    return '\n'.join(ops)

pdf_ops = svg_to_pdf_ops(WALLET_SVG_PATH)

def create_valid_pdf(stream_bytes, width=1024, height=1024):
    header = b'%PDF-1.4\n'
    obj1 = b'1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'
    obj2 = b'2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n'
    obj3 = f'3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {width} {height}] /Contents 4 0 R >>\nendobj\n'.encode('latin1')
    obj4_header = f'4 0 obj\n<< /Length {len(stream_bytes)} >>\nstream\n'.encode('latin1')
    obj4_footer = b'\nendstream\nendobj\n'

    offset1 = len(header)
    offset2 = offset1 + len(obj1)
    offset3 = offset2 + len(obj2)
    offset4 = offset3 + len(obj3)
    xref_offset = offset4 + len(obj4_header) + len(stream_bytes) + len(obj4_footer)

    xref = f'''xref
0 5
0000000000 65535 f 
{offset1:010d} 00000 n 
{offset2:010d} 00000 n 
{offset3:010d} 00000 n 
{offset4:010d} 00000 n 
trailer
<< /Size 5 /Root 1 0 R >>
startxref
{xref_offset}
%%EOF
'''.encode('latin1')

    return header + obj1 + obj2 + obj3 + obj4_header + stream_bytes + obj4_footer + xref

def main():
    workspace = '/Users/yashmehta/Documents/Work/CWallet'
    tmp_dir = '/tmp/cwallet_icon_gen'
    os.makedirs(tmp_dir, exist_ok=True)

    # 1. Master Square Icon (Solid #111111 background, white wallet centered)
    sq_pdf = os.path.join(tmp_dir, 'master_sq.pdf')
    sq_png = os.path.join(tmp_dir, 'master_sq.png')
    scale = 560.0 / 24.0
    tx = 512.0 - 12.5 * scale
    ty = 512.0 + 12.0 * scale
    sq_stream = f'''q
0.067 0.067 0.067 rg
0 0 1024 1024 re
f
1 1 1 rg
{scale:.4f} 0 0 {-scale:.4f} {tx:.4f} {ty:.4f} cm
{pdf_ops}
f*
Q'''.encode('latin1')
    with open(sq_pdf, 'wb') as f:
        f.write(create_valid_pdf(sq_stream))
    subprocess.run(['sips', '-s', 'format', 'png', sq_pdf, '--out', sq_png], check=True, capture_output=True)

    # 2. Master Round Icon (Circular disk #111111 with transparent background outside)
    rd_pdf = os.path.join(tmp_dir, 'master_rd.pdf')
    rd_png = os.path.join(tmp_dir, 'master_rd.png')
    k = 0.5522847498 * 512.0
    cx, cy = 512.0, 512.0
    circle_ops = f'''{cx+512.0:.4f} {cy:.4f} m
{cx+512.0:.4f} {cy+k:.4f} {cx+k:.4f} {cy+512.0:.4f} {cx:.4f} {cy+512.0:.4f} c
{cx-k:.4f} {cy+512.0:.4f} {cx-512.0:.4f} {cy+k:.4f} {cx-512.0:.4f} {cy:.4f} c
{cx-512.0:.4f} {cy-k:.4f} {cx-k:.4f} {cy-512.0:.4f} {cx:.4f} {cy-512.0:.4f} c
{cx+k:.4f} {cy-512.0:.4f} {cx+512.0:.4f} {cy-k:.4f} {cx+512.0:.4f} {cy:.4f} c
h'''
    rd_stream = f'''q
0.067 0.067 0.067 rg
{circle_ops}
f
1 1 1 rg
{scale:.4f} 0 0 {-scale:.4f} {tx:.4f} {ty:.4f} cm
{pdf_ops}
f*
Q'''.encode('latin1')
    with open(rd_pdf, 'wb') as f:
        f.write(create_valid_pdf(rd_stream))
    subprocess.run(['sips', '-s', 'format', 'png', rd_pdf, '--out', rd_png], check=True, capture_output=True)

    # 3. Master Foreground Icon for Adaptive Icon (Transparent background, white wallet centered in safe zone)
    fg_pdf = os.path.join(tmp_dir, 'master_fg.pdf')
    fg_png = os.path.join(tmp_dir, 'master_fg.png')
    fg_scale = 480.0 / 24.0
    fg_tx = 512.0 - 12.5 * fg_scale
    fg_ty = 512.0 + 12.0 * fg_scale
    fg_stream = f'''q
1 1 1 rg
{fg_scale:.4f} 0 0 {-fg_scale:.4f} {fg_tx:.4f} {fg_ty:.4f} cm
{pdf_ops}
f*
Q'''.encode('latin1')
    with open(fg_pdf, 'wb') as f:
        f.write(create_valid_pdf(fg_stream))
    subprocess.run(['sips', '-s', 'format', 'png', fg_pdf, '--out', fg_png], check=True, capture_output=True)

    print("Master PNGs generated successfully.")

    # 4. Generate iOS Icons
    ios_dir = os.path.join(workspace, 'ios/CWallet/Images.xcassets/AppIcon.appiconset')
    ios_targets = {
        'AppIcon-40~ipad.png': 40,
        'AppIcon-20@3x.png': 60,
        'AppIcon-29@2x.png': 58,
        'AppIcon-29@3x.png': 87,
        'AppIcon-40@2x.png': 80,
        'AppIcon@2x 1.png': 120,
        'AppIcon@2x.png': 120,
        'AppIcon@3x.png': 180,
        'AppIcon~ios-marketing.png': 1024,
    }

    for filename, size in ios_targets.items():
        out_path = os.path.join(ios_dir, filename)
        if size == 1024:
            shutil.copy(sq_png, out_path)
        else:
            subprocess.run(['sips', '-z', str(size), str(size), sq_png, '--out', out_path], check=True, capture_output=True)
        print(f"Generated iOS icon: {filename} ({size}x{size})")

    # 5. Generate Android Icons
    android_res = os.path.join(workspace, 'android/app/src/main/res')
    android_densities = {
        'mipmap-mdpi': {'sq': 48, 'rd': 48, 'fg': 108},
        'mipmap-hdpi': {'sq': 72, 'rd': 72, 'fg': 162},
        'mipmap-xhdpi': {'sq': 96, 'rd': 96, 'fg': 216},
        'mipmap-xxhdpi': {'sq': 144, 'rd': 144, 'fg': 324},
        'mipmap-xxxhdpi': {'sq': 192, 'rd': 192, 'fg': 432},
    }

    for folder, sizes in android_densities.items():
        folder_path = os.path.join(android_res, folder)
        os.makedirs(folder_path, exist_ok=True)

        # Remove old .webp files to avoid duplicate resource collisions
        for webp_name in ['ic_launcher.webp', 'ic_launcher_round.webp', 'ic_launcher_foreground.webp']:
            old_file = os.path.join(folder_path, webp_name)
            if os.path.exists(old_file):
                os.remove(old_file)

        # Generate new PNG icons
        sq_out = os.path.join(folder_path, 'ic_launcher.png')
        rd_out = os.path.join(folder_path, 'ic_launcher_round.png')
        fg_out = os.path.join(folder_path, 'ic_launcher_foreground.png')

        subprocess.run(['sips', '-z', str(sizes['sq']), str(sizes['sq']), sq_png, '--out', sq_out], check=True, capture_output=True)
        subprocess.run(['sips', '-z', str(sizes['rd']), str(sizes['rd']), rd_png, '--out', rd_out], check=True, capture_output=True)
        subprocess.run(['sips', '-z', str(sizes['fg']), str(sizes['fg']), fg_png, '--out', fg_out], check=True, capture_output=True)
        print(f"Generated Android icons for {folder}: sq={sizes['sq']}, rd={sizes['rd']}, fg={sizes['fg']}")

    # 6. Update ic_launcher_background.xml to match #111111
    bg_xml_path = os.path.join(android_res, 'values/ic_launcher_background.xml')
    bg_xml_content = '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#111111</color>\n</resources>\n'
    with open(bg_xml_path, 'w') as f:
        f.write(bg_xml_content)
    print("Updated ic_launcher_background.xml to #111111")

if __name__ == '__main__':
    main()

