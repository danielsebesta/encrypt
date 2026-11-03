from PIL import Image

img_path = r'C:\Users\dast\.t3\userdata\attachments\6588dd6f-1707-48f1-af1f-cd8166813c85-e8f431fb-0d72-4abe-bf6d-cc539d97a99b.png'
img = Image.open(img_path).convert('RGBA')
bbox = img.split()[-1].getbbox()
cropped = img.crop(bbox)

width = 60
height = 20
resized = cropped.resize((width, height), Image.Resampling.LANCZOS)

RAMP = " .:-=+*#%@"

html_spans = []

for y in range(height):
    line_html = ""
    for x in range(width):
        r, g, b, a = resized.getpixel((x, y))
        if a < 40:
            line_html += " "
            continue
        
        # Check if green lock
        is_lock = (x > 38 and y > 0)
        is_green = is_lock and (g > r or g > b) and (r + g + b > 40)
        is_keyhole = is_lock and (44 <= x <= 50) and (8 <= y <= 14) and (r + g + b < 90)
        
        lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0
        idx = int((lum ** 1.2) * (len(RAMP) - 1))
        idx = max(0, min(len(RAMP) - 1, idx))
        ch = RAMP[idx]

        if is_keyhole:
            ch = "#" if (9 <= y <= 13 and 46 <= x <= 48) else "."
            line_html += f'<span class="text-[#070b06] bg-[#31572c]">{ch}</span>'
        elif is_lock:
            # Color padlock in green/accent
            line_html += f'<span class="text-[#86efac]">{ch}</span>'
        else:
            # Hand in bone/cream/white
            if lum > 0.6:
                line_html += f'<span class="text-[#ecf39e]">{ch}</span>'
            else:
                line_html += f'<span class="text-[#7a8f6d]">{ch}</span>'
    html_spans.append(line_html)

output_html = "\n".join(html_spans)
with open(r'C:\Users\dast\encrypt\scripts\ascii_output.html', 'w', encoding='utf-8') as f:
    f.write(output_html)

print("Saved HTML ascii art!")
