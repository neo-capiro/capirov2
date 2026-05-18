from fpdf import FPDF
import re

with open('C:/Users/neoma/OneDrive/Documents/Claude/Projects/capirov2/git/capirov2/.hermes/reports/appropriations-research-report.md', 'r', encoding='utf-8') as f:
    text = f.read()

# Sanitize unicode
text = text.replace('\u2014', '-').replace('\u2013', '-').replace('\u2018', "'").replace('\u2019', "'")
text = text.replace('\u201c', '"').replace('\u201d', '"').replace('\u2022', '*').replace('\u2192', '->')

# Strip markdown formatting
text = re.sub(r'\*\*(.*?)\*\*', r'\1', text)
text = re.sub(r'\*(.*?)\*', r'\1', text)

pdf = FPDF()
pdf.set_auto_page_break(auto=True, margin=15)
pdf.add_page()
pdf.set_font('Helvetica', '', 10)

for line in text.split('\n'):
    if line.startswith('# ') and not line.startswith('## '):
        pdf.set_font('Helvetica', 'B', 16)
        pdf.set_text_color(13, 27, 62)
        pdf.multi_cell(w=0, h=10, text=line[2:])
        pdf.ln(2)
    elif line.startswith('## '):
        pdf.ln(3)
        pdf.set_font('Helvetica', 'B', 13)
        pdf.set_text_color(30, 58, 95)
        pdf.multi_cell(w=0, h=8, text=line[3:])
        pdf.ln(1)
    elif line.startswith('### '):
        pdf.ln(2)
        pdf.set_font('Helvetica', 'B', 11)
        pdf.set_text_color(55, 65, 81)
        pdf.multi_cell(w=0, h=7, text=line[4:])
    elif line.startswith('---'):
        pdf.ln(3)
    elif line.startswith('| ') and '---' in line:
        continue
    elif line.startswith('| '):
        pdf.set_font('Helvetica', '', 7)
        pdf.set_text_color(26, 26, 46)
        row = line.strip('| ').replace(' | ', ' | ')
        pdf.multi_cell(w=0, h=5, text=row)
    elif line.strip() == '':
        pdf.ln(2)
    else:
        pdf.set_font('Helvetica', '', 9)
        pdf.set_text_color(26, 26, 46)
        pdf.multi_cell(w=0, h=5, text=line)

out = 'C:/Users/neoma/OneDrive/Documents/Claude/Projects/capirov2/git/capirov2/.hermes/reports/Capiro-Appropriations-Research-Report.pdf'
pdf.output(out)
print(f'PDF saved: {out}')
