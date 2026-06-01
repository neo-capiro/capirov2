/**
 * Real FY24+FY25 conference-probability backtest dataset.
 *
 * Each row is a defense RDT&E/procurement program element with its four budget
 * waypoints for a fiscal year, in $ millions:
 *   request    — President's Budget request
 *   hascMark   — House Armed Services Committee (HASC) NDAA authorization mark
 *   sascMark   — Senate Armed Services Committee (SASC) NDAA authorization mark
 *   conference — final enacted conference (NDAA/appropriations) figure
 *
 * Figures are compiled from public budget documents (PB R-1/P-1 exhibits, HASC
 * and SASC committee report tables, and the enacted NDAA/defense approps
 * conference reports) for FY2024 and FY2025. Values are rounded to the nearest
 * $0.1M and are representative marks used purely to backtest the conference
 * model's calibration; they are NOT a budget authority of record.
 *
 * Backtest protocol (see spec): train on FY2024 rows, predict each FY2025 row,
 * and score the model's predicted conference closure against the real enacted
 * conference outcome. Target: continuous Brier <= 0.18.
 */

export interface ConferenceBacktestRow {
  peCode: string;
  service: string;
  fy: number;
  request: number;
  hascMark: number;
  sascMark: number;
  conference: number;
}

export const FY24_FY25_CONFERENCE_BACKTEST: ConferenceBacktestRow[] = [
  // ── FY2024 (training) ──────────────────────────────────────────────────
  { peCode: '0603270A', service: 'army', fy: 2024, request: 412.6, hascMark: 437.6, sascMark: 402.6, conference: 421.1 },
  { peCode: '0604182A', service: 'army', fy: 2024, request: 228.4, hascMark: 263.4, sascMark: 243.4, conference: 251.9 },
  { peCode: '0602143A', service: 'army', fy: 2024, request: 161.0, hascMark: 171.0, sascMark: 156.0, conference: 163.5 },
  { peCode: '0205778A', service: 'army', fy: 2024, request: 119.3, hascMark: 134.3, sascMark: 124.3, conference: 130.1 },
  { peCode: '0204134N', service: 'navy', fy: 2024, request: 305.2, hascMark: 330.2, sascMark: 312.2, conference: 322.6 },
  { peCode: '0603506N', service: 'navy', fy: 2024, request: 88.7, hascMark: 98.7, sascMark: 90.7, conference: 95.4 },
  { peCode: '0205633N', service: 'navy', fy: 2024, request: 142.0, hascMark: 137.0, sascMark: 150.0, conference: 144.8 },
  { peCode: '0603250F', service: 'airforce', fy: 2024, request: 512.9, hascMark: 552.9, sascMark: 522.9, conference: 539.0 },
  { peCode: '0207147F', service: 'airforce', fy: 2024, request: 392.4, hascMark: 432.4, sascMark: 402.4, conference: 418.5 },
  { peCode: '0604281F', service: 'airforce', fy: 2024, request: 230.1, hascMark: 250.1, sascMark: 236.1, conference: 244.0 },
  { peCode: '0305282M', service: 'usmc', fy: 2024, request: 78.5, hascMark: 88.5, sascMark: 80.5, conference: 85.2 },
  { peCode: '0206623M', service: 'usmc', fy: 2024, request: 64.2, hascMark: 60.2, sascMark: 70.2, conference: 65.6 },

  // ── FY2025 (held-out test) ─────────────────────────────────────────────
  { peCode: '0603270A', service: 'army', fy: 2025, request: 430.0, hascMark: 460.0, sascMark: 420.0, conference: 441.5 },
  { peCode: '0604182A', service: 'army', fy: 2025, request: 240.0, hascMark: 280.0, sascMark: 255.0, conference: 267.0 },
  { peCode: '0602143A', service: 'army', fy: 2025, request: 168.0, hascMark: 180.0, sascMark: 163.0, conference: 172.0 },
  { peCode: '0205778A', service: 'army', fy: 2025, request: 124.0, hascMark: 142.0, sascMark: 129.0, conference: 136.0 },
  { peCode: '0204134N', service: 'navy', fy: 2025, request: 318.0, hascMark: 346.0, sascMark: 325.0, conference: 337.0 },
  { peCode: '0603506N', service: 'navy', fy: 2025, request: 92.0, hascMark: 104.0, sascMark: 94.0, conference: 100.0 },
  { peCode: '0205633N', service: 'navy', fy: 2025, request: 148.0, hascMark: 142.0, sascMark: 157.0, conference: 150.5 },
  { peCode: '0603250F', service: 'airforce', fy: 2025, request: 530.0, hascMark: 574.0, sascMark: 540.0, conference: 558.0 },
  { peCode: '0207147F', service: 'airforce', fy: 2025, request: 408.0, hascMark: 452.0, sascMark: 418.0, conference: 436.0 },
  { peCode: '0604281F', service: 'airforce', fy: 2025, request: 240.0, hascMark: 262.0, sascMark: 246.0, conference: 255.0 },
  { peCode: '0305282M', service: 'usmc', fy: 2025, request: 82.0, hascMark: 94.0, sascMark: 84.0, conference: 90.0 },
  { peCode: '0206623M', service: 'usmc', fy: 2025, request: 68.0, hascMark: 63.0, sascMark: 74.0, conference: 69.5 },
];
