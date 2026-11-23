# Warehouse Management System (WMS) - Backend

Backend REST API untuk Warehouse Management System berbasis Node.js, Express, TypeScript, dan PostgreSQL, dilengkapi sistem kompilasi dokumen resmi (BASTB, Surat Jalan, Gate Pass) menggunakan XeLaTeX.

---

## 📋 Daftar Isi
- [Fitur Utama](#-fitur-utama)
- [Prasyarat Sistem](#-prasyarat-sistem)
- [Struktur Direktori](#-struktur-direktori)
- [Panduan Setup & Instalasi](#-panduan-setup--instalasi)
  - [1. Clone Repository](#1-clone-repository)
  - [2. Instal Dependensi](#2-instal-dependensi)
  - [3. Konfigurasi Environment Variable](#3-konfigurasi-environment-variable)
  - [4. Setup Database PostgreSQL](#4-setup-database-postgresql)
  - [5. Eksekusi Migrasi Database](#5-eksekusi-migrasi-database)
  - [6. Seeding Data Awal (Demo Accounts & Master Data)](#6-seeding-data-awal-demo-accounts--master-data)
  - [7. Menjalankan Aplikasi](#7-menjalankan-aplikasi)
- [Kredensial Akun Bawaan (Seed)](#-kredensial-akun-bawaan-seed)
- [Dokumentasi API (OpenAPI & Swagger)](#-dokumentasi-api-openapi--swagger)
- [Script NPM yang Tersedia](#-script-npm-yang-tersedia)
- [Catatan Khusus Kompilasi Dokumen PDF (XeLaTeX)](#-catatan-khusus-kompilasi-dokumen-pdf-xelatex)

---

## 🚀 Fitur Utama
- **Autentikasi & Autorisasi Granular (RBAC):** JWT Access & Refresh Token, Argon2id hashing, peran pengguna: `SUPER_ADMIN`, `PETUGAS_GATE`, `ADMIN_GUDANG`, `ADMIN_PERSURATAN`.
- **Master Data:** Manajemen data multi-gudang, loading dock kargo & kontainer, tipe kendaraan, dan master SKU kargo.
- **Operasional Gate (Gate-In / Gate-Out):** Validasi armada ISO 6346, penerbitan nomor tiket unik harian (`TKT-YYYYMMDD-XXXX`), alokasi dock otomatis/manual, dan pencegahan pelanggaran alur (SOP).
- **Manajemen Kargo & Inventaris Gudang:** Pelacakan stok kargo Inbound/Outbound, kapasitas gudang real-time, dan pencegahan transaksi *overdraft*.
- **Penerbitan Dokumen Resmi Berbasis LaTeX:** Worker antrean kompilasi dokumen PDF berkeamanan tinggi dengan checksum SHA-256 (BASTB, Surat Jalan, Gate Pass).

---

## 💻 Prasyarat Sistem
Pastikan perangkat/server Anda telah terpasang:
- **Node.js**: Versi `20.x` atau lebih baru (Mendukung flag `--env-file`).
- **NPM**: Versi `10.x` atau lebih baru.
- **PostgreSQL**: Versi `16.x` atau lebih baru (bisa via Docker atau instalasi lokal).
- **XeLaTeX / TeX Live** *(Opsional untuk dev lokal, wajib jika menguji render PDF)*:
  ```bash
  # Debian / Ubuntu
  sudo apt-get install -y texlive-xetex texlive-fonts-recommended texlive-plain-generic
  ```

---

## 📂 Struktur Direktori
```text
warehouse-back/
├── migrations/         # Skrip migrasi DDL PostgreSQL (node-pg-migrate)
├── src/
│   ├── config/         # Konfigurasi aplikasi & database pool
│   ├── controllers/    # Request handler Express
│   ├── db/             # Koneksi database & script seed
│   ├── middlewares/    # Middleware Auth JWT, RBAC, error handling, rate limiting
│   ├── repositories/   # Data access layer (PostgreSQL queries)
│   ├── routes/         # Definisi routing REST API
│   ├── schemas/        # Validasi schema DTO (Zod)
│   ├── services/       # Logika bisnis inti
│   ├── utils/          # Helper sanitasi LaTeX, token generator, dll
│   ├── workers/        # Worker antrean kompilasi dokumen LaTeX
│   └── server.ts       # Entry point Express app
├── storage/            # Direktori penyimpanan PDF hasil kompilasi
├── templates/          # Template dokumen .tex (BASTB, Surat Jalan, Gate Pass)
├── test/               # Integration tests suite
├── docker-compose.yml  # Setup Docker untuk PostgreSQL & backend
└── package.json
```

---

## 🛠 Panduan Setup & Instalasi

### 1. Clone Repository
```bash
git clone git@github.com:AwanArdy/warehouse-back.git
cd warehouse-back
```

### 2. Instal Dependensi
```bash
npm install
```

### 3. Konfigurasi Environment Variable
Salin file `.env.example` menjadi `.env`:
```bash
cp .env.example .env
```
Sesuaikan konfigurasi di dalam file `.env`:
```ini
NODE_ENV=development
PORT=3000

# Koneksi PostgreSQL
DATABASE_URL=postgres://warehouse_user:warehouse_secret@localhost:5432/warehouse_db
DB_POOL_MAX=20
DB_IDLE_TIMEOUT_MS=30000
DB_CONNECTION_TIMEOUT_MS=5000

# Penyimpanan Dokumen ('local' atau 's3')
STORAGE_DRIVER=local
LOCAL_STORAGE_DIR=./storage

# Keamanan JWT (Ganti dengan string random aman min. 32 karakter)
JWT_ACCESS_SECRET=kunci_rahasia_jwt_access_token_minimal_32_karakter_aman_12345
JWT_REFRESH_SECRET=kunci_rahasia_jwt_refresh_token_minimal_32_karakter_aman_67890

# Engine Kompilasi LaTeX
LATEX_BIN=xelatex
LATEX_TIMEOUT_MS=10000
```

### 4. Setup Database PostgreSQL
Anda dapat menggunakan database PostgreSQL lokal Anda atau menjalankan container PostgreSQL via Docker:
```bash
# Menjalankan PostgreSQL via Docker Compose
docker compose up -d postgres
```

> **Catatan:** Jika menggunakan `docker-compose.yml` bawaan, port PostgreSQL di-mapping ke host port `5436`. Sesuaikan port pada `DATABASE_URL` di file `.env` jika menggunakan docker compose (misal: `postgres://warehouse_user:warehouse_secret@localhost:5436/warehouse_db`).

### 5. Eksekusi Migrasi Database
Jalankan skrip migrasi untuk membuat tabel-tabel sistem:
```bash
npm run migrate:up
```
Untuk mengembalikan atau reset migrasi:
```bash
npm run migrate:reset
```

### 6. Seeding Data Awal (Demo Accounts & Master Data)
Jalankan skrip seed untuk mengisi akun default, master gudang, dock, armada, dan SKU barang:
```bash
npm run seed
```

### 7. Menjalankan Aplikasi

#### Mode Pengembangan (Development dengan Hot Reload):
```bash
npm run dev
```
Server akan berjalan di `http://localhost:3000`.

#### Mode Produksi:
```bash
npm run build
npm run start
```

---

## 👤 Kredensial Akun Bawaan (Seed)

Setelah menjalankan `npm run seed`, Anda dapat login menggunakan akun demo berikut:

| Peran (Role) | Username | Password | Deskripsi Tugas |
| :--- | :--- | :--- | :--- |
| **Super Admin** | `admin_utama` | `PasswordAdmin123!` | Akses seluruh sistem & manajemen pengguna |
| **Petugas Gate** | `petugas_pos1` | `PasswordPetugas123!` | Registrasi Gate-In & verifikasi Gate-Out |
| **Admin Gudang** | `admin_gudang1` | `PasswordGudang123!` | Alokasi dock, bongkar muat kargo, stok barang |
| **Admin Persuratan** | `admin_persuratan1` | `PasswordSurat123!` | Penerbitan & unduh dokumen BASTB / Surat Jalan / Gate Pass |

---

## 📖 Dokumentasi API (OpenAPI & Swagger)
Backend menyediakan dokumentasi OpenAPI interaktif yang dapat diakses langsung melalui browser saat server berjalan:
- **Swagger UI Interactive**: [http://localhost:3000/api-docs](http://localhost:3000/api-docs) atau [http://localhost:3000/docs](http://localhost:3000/docs)
- **OpenAPI 3.1 Spec JSON**: [http://localhost:3000/openapi.json](http://localhost:3000/openapi.json)

---

## 🧪 Script NPM yang Tersedia

| Command | Fungsi |
| :--- | :--- |
| `npm run dev` | Menjalankan server dalam mode development dengan `tsx watch` |
| `npm run build` | Melakukan kompilasi TypeScript menjadi JavaScript di folder `dist/` |
| `npm run start` | Menjalankan build produksi dari `dist/server.js` |
| `npm run typecheck` | Menjalankan type-checking TypeScript tanpa emit file |
| `npm test` | Menjalankan seluruh test suite (unit & integration tests) |
| `npm run test:integration` | Menjalankan spesifik skenario uji integrasi API Milestone 6 |
| `npm run seed` | Mengisi database dengan demo users & data master operasional |
| `npm run migrate:up` | Menjalankan migrasi database ke versi terbaru |
| `npm run migrate:down` | Melakukan rollback migrasi database terakhir |
| `npm run migrate:reset` | Me-reset seluruh migrasi database dari 0 ke versi terbaru |
| `npm run lint` | Menjalankan ESLint untuk memeriksa kualitas kode |
| `npm run format` | Memformat kode menggunakan Prettier |

---

## 📄 Catatan Khusus Kompilasi Dokumen PDF (XeLaTeX)
1. Dokumen resmi sistem (BASTB, Surat Jalan, Gate Pass) dikompilasi secara asinkron oleh worker latar belakang ([`src/workers/latex-compiler.worker.ts`](src/workers/latex-compiler.worker.ts)) menggunakan binari `xelatex`.
2. Jika server dijalankan di lingkungan tanpa instalasi `xelatex`, worker akan menghasilkan dokumen PDF mock yang aman agar alur bisnis operasional tetap dapat diuji.
3. Seluruh input karakter khusus LaTeX disanitasi secara ketat untuk mencegah kerentanan Command Injection / RCE.
