import { readFile } from "node:fs/promises";
import path from "node:path";
import type { TransactionCargoItemEntity } from "../repositories/cargo-item.repository.js";
import type { GateTransactionDetailEntity, GateTransactionRepository } from "../repositories/gate-transaction.repository.js";
import { escapeLatex, renderLatexTemplate } from "./sanitizer.js";

const TEMPLATES_DIR = path.resolve('templates');

function formatDateTimeWita(date: Date): string {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Makassar',
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(date);
}

async function loadTemplate(filename: string): Promise<string> {
  return readFile(path.join(TEMPLATES_DIR, filename), 'utf8');
}

export async function renderGatePassTex(params: {
  documentNumber: string;
  tx: GateTransactionDetailEntity;
  issuedByName: string;
}): Promise<string> {
  const template = await loadTemplate('gate_pass.tex');
  const { documentNumber, tx, issuedByName } = params;

  const containerSection = tx.container
    ? [
        '\\begin{tabularx}{\\textwidth}{@{} p{4.6cm} X @{}}',
        '  \\toprule',
        `  \\textbf{Nomor Kontainer (ISO 6346)} & \\textbf{${escapeLatex(tx.container.containerNumber)}} \\\\`,
        `  \\textbf{Ukuran Kontainer} & ${escapeLatex(tx.container.size)} \\\\`,
        `  \\textbf{Nomor Segel (Seal)} & \\textbf{${escapeLatex(tx.container.sealNumber)}} \\\\`,
        `  \\textbf{Status Muatan Awal} & ${tx.container.isEmpty ? 'EMPTY (Kosong)' : 'FULL (Bermuatan)'} \\\\`,
        '  \\bottomrule',
        '\\end{tabularx}',
      ].join('\n')
    : '\\noindent\\textit{Tidak berlaku --- Armada kategori CARGO (Mobil Box) tidak menggunakan peti kemas/kontainer.}'

  return renderLatexTemplate(template, {
    DOCUMENT_NUMBER: { kind: 'text', value: documentNumber },
    TICKET_NUMBER: { kind: 'text', value: tx.ticketNumber },
    PRINTED_AT: { kind: 'text', value: formatDateTimeWita(new Date()) },
    QR_PAYLOAD: {
      kind: 'text',
      value: `VERIFY|${documentNumber}|${tx.ticketNumber}|${tx.vehicle.plateNumber}`,
    },
    GATE_IN_AT: { kind: 'text', value: formatDateTimeWita(tx.gateInAt) },
    WAREHOUSE_CODE: { kind: 'text', value: tx.warehouse.code },
    WAREHOUSE_NAME: { kind: 'text', value: tx.warehouse.name },
    DIRECTION: { kind: 'text', value: tx.direction },
    CATEGORY: { kind: 'text', value: tx.category },
    PLATE_NUMBER: { kind: 'text', value: tx.vehicle.plateNumber },
    VEHICLE_TYPE: { kind: 'text', value: tx.vehicle.vType },
    COMPANY_NAME: { kind: 'text', value: tx.vehicle.companyName },
    MAX_WEIGHT_KG: { kind: 'text', value: tx.vehicle.maxWeightKg.toLocaleString('id-ID') },
    DRIVER_NAME: { kind: 'text', value: tx.driverName },
    DRIVER_LICENSE_NO: { kind: 'text', value: tx.driverLicenseNo },
    CONTAINER_SECTION: { kind: 'trusted_latex', value: containerSection },
    ISSUED_BY_NAME: { kind: 'text', value: issuedByName },
  });
}

function buildCargoRowsLatex(items: readonly TransactionCargoItemEntity[]): {
  rowsLatex: string;
  totalQty: string;
  totalWeightKg: string;
} {
  let sumQty = 0;
  let sumWeight = 0;

  const lines = items.map((item, index) => {
    sumQty += item.quantity;
    sumWeight += item.weightKg;

    return [
      `${index + 1}`,
      escapeLatex(item.skuCode),
      escapeLatex(item.itemName),
      escapeLatex(item.unit),
      escapeLatex(item.quantity.toLocaleString('id-ID')),
      escapeLatex(item.weightKg.toLocaleString('id-ID', { minimumFractionDigits: 2 })),
      escapeLatex(item.conditionNotes ?? 'Baik'),
    ].join(' & ') + ' \\\\';
  });

  return {
    rowsLatex: lines.join('\n  '),
    totalQty: sumQty.toLocaleString('id-ID'),
    totalWeightKg: sumWeight.toLocaleString('id-ID', { minimumFractionDigits: 2 }),
  };
}

export async function renderCargoManifestTex(params: {
  templateFile: 'bastb.tex' | 'surat_jalan.tex';
  documentNumber: string;
  tx: GateTransactionDetailEntity;
  items: readonly TransactionCargoItemEntity[];
  issuedByName: string;
}): Promise<string> {
  const template = await loadTemplate(params.templateFile);
  const { documentNumber, tx, items, issuedByName } = params;
  const { rowsLatex, totalQty, totalWeightKg } = buildCargoRowsLatex(items);

  return renderLatexTemplate(template, {
    DOCUMENT_NUMBER: { kind: 'text', value: documentNumber },
    TICKET_NUMBER: { kind: 'text', value: tx.ticketNumber },
    PRINTED_AT: { kind: 'text', value: formatDateTimeWita(new Date()) },
    QR_PAYLOAD: {
      kind: 'text',
      value: `VERIFY|${documentNumber}|${tx.ticketNumber}|${tx.vehicle.plateNumber}`,
    },
    WAREHOUSE_CODE: { kind: 'text', value: tx.warehouse.code },
    WAREHOUSE_NAME: { kind: 'text', value: tx.warehouse.name },
    DOCK_NUMBER: { kind: 'text', value: tx.dock?.dockNumber ?? '-' },
    PLATE_NUMBER: { kind: 'text', value: tx.vehicle.plateNumber },
    VEHICLE_TYPE: { kind: 'text', value: tx.vehicle.vType },
    CATEGORY: { kind: 'text', value: tx.category },
    COMPANY_NAME: { kind: 'text', value: tx.vehicle.companyName },
    DRIVER_NAME: { kind: 'text', value: tx.driverName },
    CONTAINER_NUMBER: {
      kind: 'text',
      value: tx.container ? `${tx.container.containerNumber} (${tx.container.size})` : 'N/A (Non-Kontainer)',
    },
    SEAL_NUMBER: { kind: 'text', value: tx.container?.sealNumber ?? '-' },
    CARGO_ROWS: { kind: 'trusted_latex', value: rowsLatex },
    TOTAL_QTY: { kind: 'text', value: totalQty },
    TOTAL_WEIGHT_KG: { kind: 'text', value: totalWeightKg },
    ISSUED_BY_NAME: { kind: 'text', value: issuedByName },
  });
}

export interface DailyRecapRowItem {
  ticketNumber: string;
  plateNumber: string;
  vType: string;
  direction: 'INBOUND' | 'OUTBOUND';
  containerInfo: string;
  totalWeightKg: number;
  status: string;
}

export async function renderDailyRecapTex(params: {
  documentNumber: string;
  warehouseCode: string;
  warehouseName: string;
  reportDate: string;
  rows: readonly DailyRecapRowItem[];
  issuedByName: string;
}): Promise<string> {
  const template = await loadTemplate('rekap_harian.tex');

  let inboundCount = 0;
  let outboundCount = 0;
  let inboundWeight = 0;
  let outboundWeight = 0;

  const latexRows =
    params.rows.length === 0
      ? '\\multicolumn{8}{c}{\\textit{Tidak ada aktivitas transaksi pada tanggal ini}} \\\\'
      : params.rows
          .map((r, idx) => {
            if (r.direction === 'INBOUND') {
              inboundCount += 1;
              inboundWeight += r.totalWeightKg;
            } else {
              outboundCount += 1;
              outboundWeight += r.totalWeightKg;
            }

            return (
              [
                `${idx + 1}`,
                escapeLatex(r.ticketNumber),
                escapeLatex(r.plateNumber),
                escapeLatex(r.vType),
                escapeLatex(r.direction),
                escapeLatex(r.containerInfo),
                escapeLatex(r.totalWeightKg.toLocaleString('id-ID', { minimumFractionDigits: 2 })),
                escapeLatex(r.status),
              ].join(' & ') + ' \\\\'
            );
          })
          .join('\n  ');

  return renderLatexTemplate(template, {
    DOCUMENT_NUMBER: { kind: 'text', value: params.documentNumber },
    WAREHOUSE_CODE: { kind: 'text', value: params.warehouseCode },
    WAREHOUSE_NAME: { kind: 'text', value: params.warehouseName },
    REPORT_DATE: { kind: 'text', value: params.reportDate },
    PRINTED_AT: { kind: 'text', value: formatDateTimeWita(new Date()) },
    QR_PAYLOAD: {
      kind: 'text',
      value: `VERIFY|${params.documentNumber}|${params.warehouseCode}|${params.reportDate}`,
    },
    TOTAL_VISITS: { kind: 'text', value: params.rows.length },
    INBOUND_COUNT: { kind: 'text', value: inboundCount },
    OUTBOUND_COUNT: { kind: 'text', value: outboundCount },
    TOTAL_INBOUND_WEIGHT_KG: {
      kind: 'text',
      value: inboundWeight.toLocaleString('id-ID', { minimumFractionDigits: 2 }),
    },
    TOTAL_OUTBOUND_WEIGHT_KG: {
      kind: 'text',
      value: outboundWeight.toLocaleString('id-ID', { minimumFractionDigits: 2 }),
    },
    REKAP_ROWS: { kind: 'trusted_latex', value: latexRows },
    ISSUED_BY_NAME: { kind: 'text', value: params.issuedByName },
  });
}
