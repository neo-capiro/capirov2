import { describe, expect, test } from '@jest/globals';
import * as ExcelJS from 'exceljs';
import { extractXlsxText, isSpreadsheetAttachment } from './xlsx-extract.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function makeXlsx(build: (wb: ExcelJS.Workbook) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  build(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('isSpreadsheetAttachment', () => {
  test('matches .xlsx by name or OOXML mime; not .xls / .csv / others', () => {
    expect(isSpreadsheetAttachment('budget.xlsx', '')).toBe(true);
    expect(isSpreadsheetAttachment('x', XLSX_MIME)).toBe(true);
    expect(isSpreadsheetAttachment('legacy.xls', 'application/vnd.ms-excel')).toBe(false);
    expect(isSpreadsheetAttachment('data.csv', 'text/csv')).toBe(false);
    expect(isSpreadsheetAttachment('doc.pdf', 'application/pdf')).toBe(false);
  });
});

describe('extractXlsxText', () => {
  test('renders every sheet with header + values (tab-joined rows)', async () => {
    const buf = await makeXlsx((wb) => {
      const s1 = wb.addWorksheet('Budget');
      s1.addRow(['Program', 'FY26 ($M)']);
      s1.addRow(['Hypersonics', 1200]);
      const s2 = wb.addWorksheet('Contacts');
      s2.addRow(['Name', 'Office']);
      s2.addRow(['Sarah Mitchell', 'HASC']);
    });
    const text = await extractXlsxText(buf);
    expect(text).toContain('# Budget');
    expect(text).toContain('Program\tFY26 ($M)');
    expect(text).toContain('Hypersonics\t1200');
    expect(text).toContain('# Contacts');
    expect(text).toContain('Sarah Mitchell\tHASC');
  });

  test('reads formula results, hyperlinks, and rich text', async () => {
    const buf = await makeXlsx((wb) => {
      const s = wb.addWorksheet('S');
      s.getCell('A1').value = { formula: 'SUM(1,2)', result: 3 };
      s.getCell('B1').value = { text: 'Capiro', hyperlink: 'https://capiro.ai' };
      s.getCell('C1').value = { richText: [{ text: 'Rich' }, { text: 'Text' }] };
    });
    const text = await extractXlsxText(buf);
    expect(text).toContain('3');
    expect(text).toContain('Capiro');
    expect(text).toContain('RichText');
  });

  test('returns empty string for an empty workbook', async () => {
    const buf = await makeXlsx((wb) => {
      wb.addWorksheet('Empty');
    });
    expect(await extractXlsxText(buf)).toBe('');
  });
});
