from fpdf import FPDF
import re

with open('C:/Users/neoma/OneDrive/Documents/Claude/Projects/capirov2/git/capirov2/.hermes/reports/appropriations-research-report.md', 'r', encoding='utf-8') as f:
    text = f.read()

# Force ASCII only
text = text.encode('ascii', 'replace').decode('ascii')
text = re.sub(r'\*\*(.*?)\*\*', r'\1', text)
text = re.sub(r'\*(.*?)\*', r'\1', text)

pdf = FPDF()
pdf.set_auto_page_break(auto=True, margin=15)
pdf.set_left_margin(10)
pdf.set_right_margin(10)
pdf.add_page()
pdf.set_font('Helvetica', '', 10)

lines = text.split('\n')
for i, line in enumerate(lines):
    try:
        if line.startswith('# ') and not line.startswith('## '):
            pdf.set_font('Helvetica', 'B', 16)
            pdf.multi_cell(w=0, h=10, text=line[2:])
            pdf.ln(2)
        elif line.startswith('## '):
            pdf.ln(3)
            pdf.set_font('Helvetica', 'B', 13)
            pdf.multi_cell(w=0, h=8, text=line[3:])
            pdf.ln(1)
        elif line.startswith('### '):
            pdf.ln(2)
            pdf.set_font('Helvetica', 'B', 11)
            pdf.multi_cell(w=0, h=7, text=line[4:])
        elif line.startswith('---'):
            pdf.ln(3)
        elif '---' in line and line.startswith('|'):
            continue
        elif line.startswith('|'):
            pdf.set_font('Helvetica', '', 7)
            row = line.replace('|', '  ')
            pdf.multi_cell(w=0, h=5, text=row.strip())
        elif line.strip() == '':
            pdf.ln(2)
        else:
            pdf.set_font('Helvetica', '', 9)
            pdf.multi_cell(w=0, h=5, text=line)
    except Exception as e:
        print(f"Error on line {i}: {repr(line[:80])} -> {e}")
        pdf.set_font('Helvetica', '', 9)
        pdf.ln(5)

out = 'C:/Users/neoma/OneDrive/Documents/Claude/Projects/capirov2/git/capirov2/.hermes/reports/Capiro-Appropriations-Research-Report.pdf'
pdf.output(out)
print(f'PDF saved: {out}')
