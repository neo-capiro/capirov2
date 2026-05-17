from fpdf import FPDF
import re

with open('C:/Users/neoma/OneDrive/Documents/Claude/Projects/capirov2/git/capirov2/.hermes/reports/appropriations-research-report.md', 'r', encoding='utf-8') as f:
    lines = f.readlines()

pdf = FPDF()
pdf.set_auto_page_break(auto=True, margin=15)
pdf.set_left_margin(15)
pdf.set_right_margin(15)
pdf.add_page()

for line in lines:
    line = line.rstrip('\n')
    # Sanitize unicode for latin-1 compatibility
    line = line.replace('\u2014', '-').replace('\u2013', '-').replace('\u2018', "'").replace('\u2019', "'").replace('\u201c', '"').replace('\u201d', '"').replace('\u2022', '*').replace('\u2192', '->')
    
    if line.startswith('# ') and not line.startswith('## '):
        pdf.set_font('Helvetica', 'B', 18)
        pdf.set_text_color(13, 27, 62)
        pdf.cell(0, 12, line[2:], new_x="LMARGIN", new_y="NEXT")
        pdf.set_draw_color(37, 99, 235)
        pdf.line(10, pdf.get_y(), 200, pdf.get_y())
        pdf.ln(4)
    elif line.startswith('## '):
        pdf.ln(4)
        pdf.set_font('Helvetica', 'B', 14)
        pdf.set_text_color(30, 58, 95)
        pdf.cell(0, 10, line[3:], new_x="LMARGIN", new_y="NEXT")
        pdf.set_draw_color(209, 213, 219)
        pdf.line(10, pdf.get_y(), 200, pdf.get_y())
        pdf.ln(2)
    elif line.startswith('### '):
        pdf.ln(2)
        pdf.set_font('Helvetica', 'B', 12)
        pdf.set_text_color(55, 65, 81)
        pdf.cell(0, 8, line[4:], new_x="LMARGIN", new_y="NEXT")
        pdf.ln(1)
    elif line.startswith('---'):
        pdf.set_draw_color(37, 99, 235)
        pdf.line(10, pdf.get_y()+2, 200, pdf.get_y()+2)
        pdf.ln(6)
    elif line.startswith('| ') and '---' in line:
        continue
    elif line.startswith('| '):
        pdf.set_font('Helvetica', '', 7)
        pdf.set_text_color(26, 26, 46)
        cells = [c.strip() for c in line.split('|')[1:-1]]
        col_w = min(180 / max(len(cells), 1), 45)
        for cell in cells:
            clean_cell = re.sub(r'\*\*(.*?)\*\*', r'\1', cell)
            pdf.cell(col_w, 5, clean_cell[:50], border=1)
        pdf.ln()
        pdf.set_x(15)  # reset x position after table row
    elif line.strip() == '':
        pdf.ln(3)
    else:
        pdf.set_font('Helvetica', '', 10)
        pdf.set_text_color(26, 26, 46)
        clean = re.sub(r'\*\*(.*?)\*\*', r'\1', line)
        clean = clean.lstrip('- ')
        if line.startswith('- ') or line.startswith('  -'):
            clean = '  * ' + clean
        pdf.multi_cell(0, 6, clean)

output = 'C:/Users/neoma/OneDrive/Documents/Claude/Projects/capirov2/git/capirov2/.hermes/reports/Capiro-Appropriations-Research-Report.pdf'
pdf.output(output)
print(f'PDF saved: {output}')
