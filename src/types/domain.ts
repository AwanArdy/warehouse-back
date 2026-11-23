export type TransportCategory = 'CARGO' | 'CONTAINER';
export type VehicleType = 'MOBIL_BOX' | 'TRAILER' | 'TRONTON';
export type ContainerSize = '20FT' | '40FT' | '40HC';
export type MovementDirection = 'INBOUND' | 'OUTBOUND';
export type DockStatus = 'AVAILABLE' | 'OCCUPIED' | 'MAINTENANCE';
export type GateStatus =
  | 'GATE_IN'
  | 'DOCKING'
  | 'LOADING_UNLOADING'
  | 'DOC_PENDING'
  | 'DOC_ISSUED'
  | 'GATE_OUT'
  | 'CANCELLED';
export type DocType = 'GATE_PASS' | 'BASTB' | 'SURAT_JALAN' | 'REKAP_HARIAN';
export type DocStatus = 'QUEUED' | 'COMPILING' | 'ISSUED' | 'FAILED' | 'VOID';
