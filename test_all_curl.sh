#!/usr/bin/env bash
set -uo pipefail

BASE_URL="http://127.0.0.1:3000"
LOG_FILE="/tmp/curl_test_results.log"
rm -f "$LOG_FILE"
touch "$LOG_FILE"

PASSED=0
FAILED=0
TOTAL=0

# Colors for terminal output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log() {
  echo -e "$1"
  echo -e "$1" >> "$LOG_FILE"
}

# Reset test data before run
psql -h /tmp -U warehouse_user -d warehouse_db -c "TRUNCATE users, warehouses, items_master, vehicles CASCADE;" > /dev/null 2>&1 || true

# Start server
log "${BLUE}======================================================================${NC}"
log "${BLUE}   STARTING WAREHOUSE BACKEND SERVER FOR CURL TESTING                 ${NC}"
log "${BLUE}======================================================================${NC}"

npx tsx src/server.ts > /tmp/server_test.log 2>&1 &
SERVER_PID=$!

cleanup() {
  log "\n${YELLOW}Menghentikan server backend (PID: $SERVER_PID)...${NC}"
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
  log "${GREEN}Server berhasil dihentikan.${NC}"
}
trap cleanup EXIT

# Wait for server ready
log "Menunggu server siap di $BASE_URL/health..."
READY=0
for i in {1..40}; do
  if curl -s "$BASE_URL/health" | grep -q '"status":"ok"'; then
    READY=1
    break
  fi
  sleep 1
done

if [ "$READY" -ne 1 ]; then
  log "${RED}Server gagal dijalankan. Log output:${NC}"
  cat /tmp/server_test.log
  exit 1
fi
log "${GREEN}Server aktif dan siap menerima request!${NC}\n"

# Helper test function
test_curl() {
  local TEST_NAME="$1"
  local METHOD="$2"
  local ENDPOINT="$3"
  local EXPECTED_STATUS="$4"
  local DATA="${5:-}"
  local TOKEN="${6:-}"

  TOTAL=$((TOTAL + 1))

  local CMD=(curl -s -w "\nHTTP_STATUS:%{http_code}" -X "$METHOD" "$BASE_URL$ENDPOINT")
  CMD+=(-H "Content-Type: application/json")

  if [ -n "$TOKEN" ]; then
    CMD+=(-H "Authorization: Bearer $TOKEN")
  fi

  if [ -n "$DATA" ]; then
    CMD+=(-d "$DATA")
  fi

  local RESPONSE
  RESPONSE=$("${CMD[@]}")

  local STATUS
  STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS:" | cut -d':' -f2)
  local BODY
  BODY=$(echo "$RESPONSE" | sed '/HTTP_STATUS:/d')

  if [ "$STATUS" = "$EXPECTED_STATUS" ]; then
    PASSED=$((PASSED + 1))
    log "[PASS] $TOTAL. $TEST_NAME: $METHOD $ENDPOINT -> Status $STATUS"
  else
    FAILED=$((FAILED + 1))
    log "[FAIL] $TOTAL. $TEST_NAME: $METHOD $ENDPOINT -> Got $STATUS (Expected $EXPECTED_STATUS)"
    log "  Response: $BODY"
  fi

  LAST_BODY="$BODY"
  LAST_STATUS="$STATUS"
}

# Helper to extract JSON field using node
extract_json() {
  local FIELD="$1"
  echo "$LAST_BODY" | node -e "
    const fs = require('fs');
    try {
      const data = JSON.parse(fs.readFileSync(0, 'utf-8'));
      const val = $FIELD;
      if (val !== undefined && val !== null) {
        console.log(val);
      }
    } catch (e) {
      process.exit(0);
    }
  "
}

log "${BLUE}======================================================================${NC}"
log "${BLUE} 1. SYSTEM HEALTH CHECK                                                ${NC}"
log "${BLUE}======================================================================${NC}"
test_curl "Check Health" "GET" "/health" "200"

log "\n${BLUE}======================================================================${NC}"
log "${BLUE} 2. AUTHENTICATION & RBAC                                             ${NC}"
log "${BLUE}======================================================================${NC}"

# Bootstrap Admin
test_curl "Bootstrap Admin" "POST" "/api/v1/auth/bootstrap-admin" "201" \
  '{"username":"admin_utama","fullName":"Super Administrator","password":"PasswordAdmin123!"}'

# Re-bootstrap should conflict (409)
test_curl "Bootstrap Admin Ulang (Conflict 409)" "POST" "/api/v1/auth/bootstrap-admin" "409" \
  '{"username":"admin_kedua","fullName":"Admin Dua","password":"PasswordAdmin123!"}'

# Login Admin
test_curl "Login Admin" "POST" "/api/v1/auth/login" "200" \
  '{"username":"admin_utama","password":"PasswordAdmin123!"}'
ADMIN_ACCESS_TOKEN=$(extract_json "data.data.accessToken")
ADMIN_REFRESH_TOKEN=$(extract_json "data.data.refreshToken")

# Get Current User (/auth/me)
test_curl "Get Profile Admin (/auth/me)" "GET" "/api/v1/auth/me" "200" "" "$ADMIN_ACCESS_TOKEN"

# List Roles
test_curl "List Roles" "GET" "/api/v1/roles" "200" "" "$ADMIN_ACCESS_TOKEN"

# Create User: Petugas Gate
test_curl "Create User Petugas Gate" "POST" "/api/v1/users" "201" \
  '{"username":"petugas_pos1","fullName":"Budi Santoso","password":"PasswordPetugas123!","roleCode":"PETUGAS_GATE"}' \
  "$ADMIN_ACCESS_TOKEN"

# Create User: Admin Gudang
test_curl "Create User Admin Gudang" "POST" "/api/v1/users" "201" \
  '{"username":"admin_gudang1","fullName":"Siti Rahma","password":"PasswordGudang123!","roleCode":"ADMIN_GUDANG"}' \
  "$ADMIN_ACCESS_TOKEN"

# List Users
test_curl "List Users" "GET" "/api/v1/users" "200" "" "$ADMIN_ACCESS_TOKEN"

# Login as Petugas Gate
test_curl "Login Petugas Gate" "POST" "/api/v1/auth/login" "200" \
  '{"username":"petugas_pos1","password":"PasswordPetugas123!"}'
GATE_ACCESS_TOKEN=$(extract_json "data.data.accessToken")
GATE_REFRESH_TOKEN=$(extract_json "data.data.refreshToken")

# Refresh Token test
test_curl "Refresh Access Token" "POST" "/api/v1/auth/refresh" "200" \
  "{\"refreshToken\":\"$GATE_REFRESH_TOKEN\"}"
GATE_NEW_ACCESS_TOKEN=$(extract_json "data.data.accessToken")
GATE_NEW_REFRESH_TOKEN=$(extract_json "data.data.refreshToken")

# Logout test
test_curl "Logout User" "POST" "/api/v1/auth/logout" "200" \
  "{\"refreshToken\":\"$GATE_NEW_REFRESH_TOKEN\"}"

# Re-login gate officer for subsequent gate operations
test_curl "Re-login Petugas Gate" "POST" "/api/v1/auth/login" "200" \
  '{"username":"petugas_pos1","password":"PasswordPetugas123!"}'
GATE_ACCESS_TOKEN=$(extract_json "data.data.accessToken")

# Login as Admin Gudang
test_curl "Login Admin Gudang" "POST" "/api/v1/auth/login" "200" \
  '{"username":"admin_gudang1","password":"PasswordGudang123!"}'
GUDANG_ACCESS_TOKEN=$(extract_json "data.data.accessToken")

# Audit Logs
test_curl "List Audit Logs" "GET" "/api/v1/audit-logs" "200" "" "$ADMIN_ACCESS_TOKEN"

log "\n${BLUE}======================================================================${NC}"
log "${BLUE} 3. MASTER DATA (WAREHOUSE, DOCK, VEHICLE, ITEM)                      ${NC}"
log "${BLUE}======================================================================${NC}"

# Create Warehouse A
test_curl "Create Warehouse A" "POST" "/api/v1/warehouses" "201" \
  '{"code":"GUD-A","name":"Gudang Utama Distribusi A","maxVolumeM3":50000}' \
  "$ADMIN_ACCESS_TOKEN"
WAREHOUSE_A_ID=$(extract_json "data.data.id")

# List Warehouses
test_curl "List Warehouses" "GET" "/api/v1/warehouses" "200" "" "$ADMIN_ACCESS_TOKEN"

# Create CARGO Dock
test_curl "Create Dock CARGO (DOCK-01)" "POST" "/api/v1/docks" "201" \
  "{\"warehouseId\":\"$WAREHOUSE_A_ID\",\"dockNumber\":\"DOCK-01\",\"category\":\"CARGO\"}" \
  "$ADMIN_ACCESS_TOKEN"
DOCK_CARGO_ID=$(extract_json "data.data.id")

# Create CONTAINER Dock
test_curl "Create Dock CONTAINER (DOCK-02)" "POST" "/api/v1/docks" "201" \
  "{\"warehouseId\":\"$WAREHOUSE_A_ID\",\"dockNumber\":\"DOCK-02\",\"category\":\"CONTAINER\"}" \
  "$ADMIN_ACCESS_TOKEN"
DOCK_CONTAINER_ID=$(extract_json "data.data.id")

# List Docks
test_curl "List Docks" "GET" "/api/v1/docks" "200" "" "$ADMIN_ACCESS_TOKEN"

# Update Dock Status (MAINTENANCE then AVAILABLE)
test_curl "Update Dock Status -> MAINTENANCE" "PATCH" "/api/v1/docks/$DOCK_CARGO_ID/status" "200" \
  '{"status":"MAINTENANCE"}' "$ADMIN_ACCESS_TOKEN"
test_curl "Update Dock Status -> AVAILABLE" "PATCH" "/api/v1/docks/$DOCK_CARGO_ID/status" "200" \
  '{"status":"AVAILABLE"}' "$ADMIN_ACCESS_TOKEN"

# Register CARGO Vehicle
test_curl "Register Vehicle Mobil Box" "POST" "/api/v1/vehicles" "201" \
  '{"plateNumber":"B 1234 ABC","category":"CARGO","vType":"MOBIL_BOX","companyName":"PT Ekspedisi Cepat","maxWeightKg":5000}' \
  "$ADMIN_ACCESS_TOKEN"
VEHICLE_CARGO_ID=$(extract_json "data.data.id")

# Register CONTAINER Vehicle
test_curl "Register Vehicle Trailer" "POST" "/api/v1/vehicles" "201" \
  '{"plateNumber":"B 9876 XYZ","category":"CONTAINER","vType":"TRAILER","companyName":"PT Logistik Maritim","maxWeightKg":32000}' \
  "$ADMIN_ACCESS_TOKEN"
VEHICLE_CONTAINER_ID=$(extract_json "data.data.id")

# List Vehicles
test_curl "List Vehicles" "GET" "/api/v1/vehicles" "200" "" "$ADMIN_ACCESS_TOKEN"

# Lookup Vehicle by Plate
test_curl "Lookup Vehicle by Plate" "GET" "/api/v1/vehicles/plate/B1234ABC" "200" "" "$ADMIN_ACCESS_TOKEN"

# Create Item Master
test_curl "Create Item SKU-ELEK-01" "POST" "/api/v1/items" "201" \
  '{"skuCode":"SKU-ELEK-01","name":"Ergonomic Laptop Stand","unit":"PCS","unitVolumeM3":0.015,"unitWeightKg":1.2}' \
  "$ADMIN_ACCESS_TOKEN"
ITEM_1_ID=$(extract_json "data.data.id")

test_curl "Create Item SKU-ELEK-02" "POST" "/api/v1/items" "201" \
  '{"skuCode":"SKU-ELEK-02","name":"Mechanical Gaming Keyboard","unit":"PCS","unitVolumeM3":0.008,"unitWeightKg":0.9}' \
  "$ADMIN_ACCESS_TOKEN"
ITEM_2_ID=$(extract_json "data.data.id")

# List Items
test_curl "List Items Master" "GET" "/api/v1/items" "200" "" "$ADMIN_ACCESS_TOKEN"

log "\n${BLUE}======================================================================${NC}"
log "${BLUE} 4. INBOUND WORKFLOW: GATE-IN -> DOCK -> CARGO -> FINALIZE -> DOC -> GATE-OUT ${NC}"
log "${BLUE}======================================================================${NC}"

# Gate-In CARGO Vehicle
test_curl "Gate-In Inbound Mobil Box" "POST" "/api/v1/gate/in" "201" \
  "{\"vehicleId\":\"$VEHICLE_CARGO_ID\",\"warehouseId\":\"$WAREHOUSE_A_ID\",\"driverName\":\"Agus Kurniawan\",\"driverLicenseNo\":\"SIM-B2-998877\",\"direction\":\"INBOUND\"}" \
  "$GATE_ACCESS_TOKEN"
GATE_TX_INBOUND_ID=$(extract_json "data.data.id")

# List Gate Transactions
test_curl "List Gate Transactions" "GET" "/api/v1/gate/transactions" "200" "" "$GATE_ACCESS_TOKEN"

# Get Gate Transaction Detail
test_curl "Get Gate Transaction Detail" "GET" "/api/v1/gate/transactions/$GATE_TX_INBOUND_ID" "200" "" "$GATE_ACCESS_TOKEN"

# Assign Dock (Dock Admin)
test_curl "Assign Dock to Transaction" "POST" "/api/v1/gate/transactions/$GATE_TX_INBOUND_ID/assign-dock" "200" \
  "{\"dockId\":\"$DOCK_CARGO_ID\"}" \
  "$GUDANG_ACCESS_TOKEN"

# Record Cargo Items
test_curl "Record Inbound Cargo Items" "PUT" "/api/v1/gate/transactions/$GATE_TX_INBOUND_ID/cargo-items" "200" \
  "{\"items\":[{\"itemId\":\"$ITEM_1_ID\",\"quantity\":100,\"weightKg\":120,\"conditionNotes\":\"Kondisi baik, segel rapi\"},{\"itemId\":\"$ITEM_2_ID\",\"quantity\":50,\"weightKg\":45,\"conditionNotes\":\"Kondisi kardus mulus\"}]}" \
  "$GUDANG_ACCESS_TOKEN"

# Get Cargo Items for Transaction
test_curl "Get Recorded Cargo Items" "GET" "/api/v1/gate/transactions/$GATE_TX_INBOUND_ID/cargo-items" "200" "" "$GUDANG_ACCESS_TOKEN"

# Finalize Inbound Unloading
test_curl "Finalize Inbound Unloading" "POST" "/api/v1/gate/transactions/$GATE_TX_INBOUND_ID/finalize-inbound" "200" "" "$GUDANG_ACCESS_TOKEN"

# Verify Warehouse Inventory
test_curl "Check Warehouse Inventory" "GET" "/api/v1/warehouses/$WAREHOUSE_A_ID/inventory" "200" "" "$GUDANG_ACCESS_TOKEN"

# Check Stock Movements Ledger
test_curl "Check Stock Movements Ledger" "GET" "/api/v1/inventory/movements" "200" "" "$GUDANG_ACCESS_TOKEN"

# Generate Official Document (BASTB)
test_curl "Generate BASTB Document" "POST" "/api/v1/gate/transactions/$GATE_TX_INBOUND_ID/documents" "202" \
  '{"docType":"BASTB"}' \
  "$ADMIN_ACCESS_TOKEN"
BASTB_DOC_ID=$(extract_json "data.data.id")

# Wait for worker compilation
log "Menunggu worker mengompilasi dokumen LaTeX..."
sleep 2

# List Documents
test_curl "List Documents" "GET" "/api/v1/documents" "200" "" "$ADMIN_ACCESS_TOKEN"

# Get Document Detail
test_curl "Get Document Detail" "GET" "/api/v1/documents/$BASTB_DOC_ID" "200" "" "$ADMIN_ACCESS_TOKEN"

# Download PDF Document
test_curl "Download Document PDF" "GET" "/api/v1/documents/$BASTB_DOC_ID/pdf" "200" "" "$ADMIN_ACCESS_TOKEN"

# Gate-Out
test_curl "Gate-Out Inbound Vehicle" "POST" "/api/v1/gate/transactions/$GATE_TX_INBOUND_ID/gate-out" "200" \
  '{"notes":"Bongkar muat selesai, dokumen BASTB telah diterima driver"}' \
  "$GATE_ACCESS_TOKEN"

log "\n${BLUE}======================================================================${NC}"
log "${BLUE} 5. OUTBOUND WORKFLOW: GATE-IN -> DOCK -> CARGO -> FINALIZE -> DOC -> GATE-OUT${NC}"
log "${BLUE}======================================================================${NC}"

# Register Outbound Vehicle
test_curl "Register Outbound Mobil Box" "POST" "/api/v1/vehicles" "201" \
  '{"plateNumber":"B 5555 OUT","category":"CARGO","vType":"MOBIL_BOX","companyName":"PT Distribusi Retail","maxWeightKg":4000}' \
  "$ADMIN_ACCESS_TOKEN"
VEHICLE_OUTBOUND_ID=$(extract_json "data.data.id")

# Gate-In Outbound
test_curl "Gate-In Outbound Mobil Box" "POST" "/api/v1/gate/in" "201" \
  "{\"vehicleId\":\"$VEHICLE_OUTBOUND_ID\",\"warehouseId\":\"$WAREHOUSE_A_ID\",\"driverName\":\"Hendra Wijaya\",\"driverLicenseNo\":\"SIM-B1-123456\",\"direction\":\"OUTBOUND\"}" \
  "$GATE_ACCESS_TOKEN"
GATE_TX_OUTBOUND_ID=$(extract_json "data.data.id")

# Assign Dock
test_curl "Assign Dock to Outbound Transaction" "POST" "/api/v1/gate/transactions/$GATE_TX_OUTBOUND_ID/assign-dock" "200" \
  "{\"dockId\":\"$DOCK_CARGO_ID\"}" \
  "$GUDANG_ACCESS_TOKEN"

# Record Cargo Items to Outbound (Take 30 of SKU-ELEK-01)
test_curl "Record Outbound Cargo Items" "PUT" "/api/v1/gate/transactions/$GATE_TX_OUTBOUND_ID/cargo-items" "200" \
  "{\"items\":[{\"itemId\":\"$ITEM_1_ID\",\"quantity\":30,\"weightKg\":36,\"conditionNotes\":\"Muat barang pesanan PO-2026-001\"}]}" \
  "$GUDANG_ACCESS_TOKEN"

# Finalize Outbound
test_curl "Finalize Outbound Loading" "POST" "/api/v1/gate/transactions/$GATE_TX_OUTBOUND_ID/finalize-outbound" "200" "" "$GUDANG_ACCESS_TOKEN"

# Verify Warehouse Inventory (stock should decrease from 100 to 70)
test_curl "Check Warehouse Inventory After Outbound" "GET" "/api/v1/warehouses/$WAREHOUSE_A_ID/inventory" "200" "" "$GUDANG_ACCESS_TOKEN"

# Generate Official Document (SURAT_JALAN)
test_curl "Generate SURAT_JALAN Document" "POST" "/api/v1/gate/transactions/$GATE_TX_OUTBOUND_ID/documents" "202" \
  '{"docType":"SURAT_JALAN"}' \
  "$ADMIN_ACCESS_TOKEN"

sleep 2

# Gate-Out Outbound Vehicle
test_curl "Gate-Out Outbound Vehicle" "POST" "/api/v1/gate/transactions/$GATE_TX_OUTBOUND_ID/gate-out" "200" \
  '{"notes":"Muat barang selesai, surat jalan dibawa driver"}' \
  "$GATE_ACCESS_TOKEN"

log "\n${BLUE}======================================================================${NC}"
log "${BLUE} 6. CONTAINER & GATE-PASS TEST                                         ${NC}"
log "${BLUE}======================================================================${NC}"

# Gate-In Container Vehicle
test_curl "Gate-In Container Trailer" "POST" "/api/v1/gate/in" "201" \
  "{\"vehicleId\":\"$VEHICLE_CONTAINER_ID\",\"warehouseId\":\"$WAREHOUSE_A_ID\",\"driverName\":\"Joko Santoso\",\"driverLicenseNo\":\"SIM-B2-887766\",\"direction\":\"INBOUND\",\"container\":{\"containerNumber\":\"MSCU1234567\",\"size\":\"40HC\",\"sealNumber\":\"SEAL-998877\",\"isEmpty\":false}}" \
  "$GATE_ACCESS_TOKEN"
GATE_TX_CONTAINER_ID=$(extract_json "data.data.id")

# Generate Gate Pass Document
test_curl "Generate GATE_PASS Document" "POST" "/api/v1/gate/transactions/$GATE_TX_CONTAINER_ID/documents" "202" \
  '{"docType":"GATE_PASS"}' \
  "$ADMIN_ACCESS_TOKEN"

sleep 2

log "\n${BLUE}======================================================================${NC}"
log "${BLUE} 7. DAILY RECAP & DOCUMENT VOIDING                                     ${NC}"
log "${BLUE}======================================================================${NC}"

# Generate Daily Recap
TODAY=$(date +%Y-%m-%d)
test_curl "Generate Daily Recap Document" "POST" "/api/v1/documents/daily-recap" "202" \
  "{\"warehouseId\":\"$WAREHOUSE_A_ID\",\"reportDate\":\"$TODAY\"}" \
  "$ADMIN_ACCESS_TOKEN"
RECAP_DOC_ID=$(extract_json "data.data.id")

sleep 2

# Void Document
test_curl "Void Document" "POST" "/api/v1/documents/$BASTB_DOC_ID/void" "200" \
  '{"voidReason":"Terdapat revisi fisik kuantitas barang di lapangan"}' \
  "$ADMIN_ACCESS_TOKEN"

# Check Voided Document Status
test_curl "Verify Document Status VOID" "GET" "/api/v1/documents/$BASTB_DOC_ID" "200" "" "$ADMIN_ACCESS_TOKEN"

log "\n${BLUE}======================================================================${NC}"
log "${BLUE} 8. NEGATIVE TESTING & SECURITY VERIFICATION                           ${NC}"
log "${BLUE}======================================================================${NC}"

# Unauthorized without token -> 401
test_curl "Akses Protected Endpoint Tanpa Token (401)" "GET" "/api/v1/warehouses" "401"

# Forbidden insufficient permission (Petugas Gate mencoba create user) -> 403
test_curl "Akses Endpoint Tanpa Izin Granular (403)" "POST" "/api/v1/users" "403" \
  '{"username":"hacker","fullName":"Hacker","password":"Password123!","roleCode":"SUPER_ADMIN"}' \
  "$GATE_ACCESS_TOKEN"

# Bad Request (Payload tidak valid) -> 400
test_curl "Zod Validation Error / Payload Invalid (400)" "POST" "/api/v1/warehouses" "400" \
  '{"code":"X","name":"","maxVolumeM3":-10}' \
  "$ADMIN_ACCESS_TOKEN"

# Not Found -> 404
test_curl "Resource Not Found (404)" "GET" "/api/v1/gate/transactions/00000000-0000-0000-0000-000000000000" "404" \
  "" "$ADMIN_ACCESS_TOKEN"

# Container validation on CARGO vehicle -> 422
test_curl "Aturan Bisnis: Container pada Mobil Box Ditolak (422)" "POST" "/api/v1/gate/in" "422" \
  "{\"vehicleId\":\"$VEHICLE_CARGO_ID\",\"warehouseId\":\"$WAREHOUSE_A_ID\",\"driverName\":\"Driver\",\"driverLicenseNo\":\"SIM-123\",\"direction\":\"INBOUND\",\"container\":{\"containerNumber\":\"MSCU1234567\",\"size\":\"20FT\",\"sealNumber\":\"SEAL123\",\"isEmpty\":false}}" \
  "$GATE_ACCESS_TOKEN"

log "\n${BLUE}======================================================================${NC}"
log "${BLUE}                    RINGKASAN HASIL PENGUJIAN CURL                    ${NC}"
log "${BLUE}======================================================================${NC}"
log "Total Pengujian : $TOTAL"
log "${GREEN}Lulus (PASSED)  : $PASSED${NC}"
if [ "$FAILED" -gt 0 ]; then
  log "${RED}Gagal (FAILED)  : $FAILED${NC}"
else
  log "${GREEN}Gagal (FAILED)  : 0${NC}"
fi
log "${BLUE}======================================================================${NC}"

if [ "$FAILED" -eq 0 ]; then
  exit 0
else
  exit 1
fi
