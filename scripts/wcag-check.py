import sys

def lum(r, g, b):
    def ch(c):
        c = c / 255.0
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)

def cr(c1, c2):
    r1, g1, b1 = int(c1[1:3], 16), int(c1[3:5], 16), int(c1[5:7], 16)
    r2, g2, b2 = int(c2[1:3], 16), int(c2[3:5], 16), int(c2[5:7], 16)
    l1, l2 = lum(r1, g1, b1), lum(r2, g2, b2)
    lighter = max(l1, l2)
    darker = min(l1, l2)
    return (lighter + 0.05) / (darker + 0.05)

# Current design tokens from src/styles/global.css
palette = {
    'bg_light': '#ffffff',
    'surface_light': '#fafbfa',
    'text_light': '#111a10',
    'muted_light': '#4e5f4c',
    'accent_light': '#2e5921',
    'on_accent_light': '#ffffff',
    'bg_dark': '#08110a',
    'surface_dark': '#0e180d',
    'text_dark': '#e6f0cc',
    'muted_dark': '#a9b59e',
    'accent_dark': '#86b94a',
    'on_accent_dark': '#070b06',
    'call_bg': '#070b06',
    'call_muted': '#c4d0bd',
    'call_text': '#ecf39e',
}

pairs = [
    ('light text/bg', 'text_light', 'bg_light'),
    ('light muted/bg', 'muted_light', 'bg_light'),
    ('light muted/surface', 'muted_light', 'surface_light'),
    ('light on-accent/accent', 'on_accent_light', 'accent_light'),
    ('dark text/bg', 'text_dark', 'bg_dark'),
    ('dark muted/bg', 'muted_dark', 'bg_dark'),
    ('dark on-accent/accent', 'on_accent_dark', 'accent_dark'),
    ('call muted/bg', 'call_muted', 'call_bg'),
    ('call text/bg', 'call_text', 'call_bg'),
]

print(f"{'TEST PAIR':40} | {'RATIO':7} | {'WCAG AA (4.5:1)':18} | {'WCAG AAA (7:1)'}")
print('-' * 80)
for label, c1, c2 in pairs:
    ratio = cr(palette[c1], palette[c2])
    aa = "PASS" if ratio >= 4.5 else ("PASS (Large 3:1)" if ratio >= 3.0 else "FAIL")
    aaa = "PASS" if ratio >= 7.0 else ("PASS (Large 4.5:1)" if ratio >= 4.5 else "FAIL")
    status = "[OK]  " if ratio >= 4.5 else ("[WARN]" if ratio >= 3.0 else "[FAIL]")
    print(f"{status} {label:33} | {ratio:5.2f}:1 | {aa:18} | {aaa}")
