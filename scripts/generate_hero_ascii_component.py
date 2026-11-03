from PIL import Image

img_path = r'C:\Users\dast\.t3\userdata\attachments\6588dd6f-1707-48f1-af1f-cd8166813c85-e8f431fb-0d72-4abe-bf6d-cc539d97a99b.png'
img = Image.open(img_path).convert('RGBA')
bbox = img.split()[-1].getbbox()
cropped = img.crop(bbox)

# Clean terminal proportions
width = 54
height = 18
resized = cropped.resize((width, height), Image.Resampling.LANCZOS)

RAMP = " .:;+=xX$&#"

html_lines = []

for y in range(height):
    line_html = ""
    for x in range(width):
        r, g, b, a = resized.getpixel((x, y))
        if a < 35:
            line_html += " "
            continue
        
        # Color & object detection
        # Hand vs Lock
        is_lock = (x >= 34)
        is_keyhole = is_lock and (40 <= x <= 45) and (8 <= y <= 13) and (r + g + b < 95)
        
        lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0
        idx = int((lum ** 1.1) * (len(RAMP) - 1))
        idx = max(0, min(len(RAMP) - 1, idx))
        ch = RAMP[idx]

        if is_keyhole:
            # Dark hollow inside lock
            line_html += f'<span class="text-[#070b06] bg-[#223c1b] font-bold">█</span>'
        elif is_lock:
            # Green padlock
            if lum > 0.45:
                line_html += f'<span class="text-[#86efac]">{ch}</span>'
            else:
                line_html += f'<span class="text-[#4f772d]">{ch}</span>'
        else:
            # Reaching hand
            if lum > 0.55:
                line_html += f'<span class="text-[#ecf39e]">{ch}</span>'
            else:
                line_html += f'<span class="text-[#7a8f6d]">{ch}</span>'
                
    html_lines.append(line_html)

output_html = "\n".join(html_lines)
with open(r'C:\Users\dast\encrypt\src\components\home\HeroAsciiArt.astro', 'w', encoding='utf-8') as f:
    f.write(f'''---
// Generated from padlock & hand 3D artwork
---

<div class="relative flex items-center justify-center p-3 rounded-xl border border-line bg-surface select-none overflow-hidden font-mono text-[9px] sm:text-[10.5px] md:text-[11px] leading-[1.05] tracking-[-0.05em] shadow-xl" aria-hidden="true">
  <div class="absolute inset-0 bg-radial from-emerald-500/5 to-transparent pointer-events-none"></div>
  <pre class="relative whitespace-pre font-mono font-bold transition-transform hover:scale-[1.02] duration-300">
{output_html}
  </pre>
</div>
''')

print("Created HeroAsciiArt.astro successfully!")
